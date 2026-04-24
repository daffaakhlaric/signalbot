// ============================================================
// BTC SNIPER BOT — Backend Server (BingX edition)
// Polls BingX perpetual futures klines → computes indicators
// → GPT-4o-mini analysis → broadcasts via WebSocket
// ============================================================

require("dotenv").config();
const dns = require("node:dns");
// Prefer IPv4 to avoid "fetch failed" when IPv6 is not routable (common on Windows / ISP).
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Serve the dashboard (index.html + any assets in project root)
app.use(express.static(path.join(__dirname)));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Config ─────────────────────────────────────────────────────
// DATA_SOURCE: bybit | okx | binance | bingx | auto (tries each in order)
const DATA_SOURCE = (process.env.DATA_SOURCE || "auto").toLowerCase();
const FALLBACK_ORDER = ["bybit", "okx", "binance", "bingx"];

const SYMBOL = process.env.SYMBOL || "BTC-USDT";              // dash format; auto-converted per exchange
const INTERVAL = process.env.INTERVAL || "15m";
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);
const KLINE_LIMIT = 250;                                      // enough for EMA200

const BINGX_BASE   = process.env.BINGX_BASE   || "https://open-api.bingx.com";
const BINGX_API_KEY    = process.env.BINGX_API_KEY    || "";
const BINGX_API_SECRET = process.env.BINGX_API_SECRET || "";
const BINANCE_BASE = process.env.BINANCE_BASE || "https://fapi.binance.com";
const BYBIT_BASE   = process.env.BYBIT_BASE   || "https://api.bybit.com";
const OKX_BASE     = process.env.OKX_BASE     || "https://www.okx.com";

let activeSource = DATA_SOURCE === "auto" ? null : DATA_SOURCE;

// ── State ──────────────────────────────────────────────────────
let signalHistory = [];
let latestSignal = null;
let latestPayload = null;
let lastAnalyzedBarTime = 0;

// ── WebSocket broadcast ────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

wss.on("connection", (ws) => {
  console.log("📡 Dashboard connected");
  if (latestPayload) ws.send(JSON.stringify({ type: "market_data", data: latestPayload }));
  if (latestSignal)  ws.send(JSON.stringify({ type: "signal", data: latestSignal }));
  if (signalHistory.length) ws.send(JSON.stringify({ type: "history", data: signalHistory }));
  if (latestPositions) ws.send(JSON.stringify({ type: "positions", data: latestPositions }));
});

// ── HTTP helper with timeout + friendly error messages ────────
async function httpGet(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 btc-sniper-bot/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    const code = e.cause?.code || e.code || "";
    const msg  = e.cause?.message || e.message;
    throw new Error(`network → ${code ? code + " " : ""}${msg}`);
  } finally {
    clearTimeout(t);
  }
}

// ── BingX perpetual futures klines ────────────────────────────
// Docs: https://bingx-api.github.io/docs/#/swapV2/market-api.html
async function fetchKlinesBingX(symbol, interval, limit) {
  const url = `${BINGX_BASE}/openApi/swap/v2/quote/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const json = await httpGet(url);
  if (json.code !== 0) throw new Error(`BingX error ${json.code}: ${json.msg}`);
  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw new Error("BingX returned empty data");
  }
  return json.data
    .map((k) => ({
      time:   Number(k.time),
      open:   Number(k.open),
      high:   Number(k.high),
      low:    Number(k.low),
      close:  Number(k.close),
      volume: Number(k.volume),
    }))
    .sort((a, b) => a.time - b.time);
}

// ── Binance USDT-M futures klines ─────────────────────────────
async function fetchKlinesBinance(symbol, interval, limit) {
  const binSymbol = symbol.replace("-", "");                  // BTC-USDT → BTCUSDT
  const url = `${BINANCE_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(binSymbol)}&interval=${interval}&limit=${limit}`;
  const arr = await httpGet(url);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("Binance returned empty data");
  // [openTime, open, high, low, close, volume, closeTime, ...]
  return arr.map((k) => ({
    time: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
    low:  Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
  }));
}

// ── Bybit linear perpetual klines ─────────────────────────────
// Docs: https://bybit-exchange.github.io/docs/v5/market/kline
async function fetchKlinesBybit(symbol, interval, limit) {
  const bySymbol = symbol.replace("-", "");                   // BTC-USDT → BTCUSDT
  // Bybit interval: numeric minutes for < 1d, then D/W/M
  const map = { "1m":"1","3m":"3","5m":"5","15m":"15","30m":"30",
                "1h":"60","2h":"120","4h":"240","6h":"360","12h":"720",
                "1d":"D","1w":"W","1M":"M" };
  const byInterval = map[interval] || "15";
  const url = `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${bySymbol}&interval=${byInterval}&limit=${limit}`;
  const json = await httpGet(url);
  if (json.retCode !== 0) throw new Error(`Bybit error ${json.retCode}: ${json.retMsg}`);
  const arr = json.result?.list;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("Bybit returned empty data");
  // Bybit returns newest first: [startTime, open, high, low, close, volume, turnover]
  return arr
    .map((k) => ({
      time: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
      low:  Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
    }))
    .sort((a, b) => a.time - b.time);
}

// ── OKX perpetual swap klines ─────────────────────────────────
// Docs: https://www.okx.com/docs-v5/en/#public-data-rest-api-get-candlesticks
async function fetchKlinesOKX(symbol, interval, limit) {
  const okxSymbol = `${symbol}-SWAP`;                         // BTC-USDT → BTC-USDT-SWAP
  // OKX interval uppercase for h/d/w/M
  const map = { "1m":"1m","3m":"3m","5m":"5m","15m":"15m","30m":"30m",
                "1h":"1H","2h":"2H","4h":"4H","6h":"6H","12h":"12H",
                "1d":"1D","1w":"1W","1M":"1M" };
  const okxInterval = map[interval] || "15m";
  const url = `${OKX_BASE}/api/v5/market/candles?instId=${okxSymbol}&bar=${okxInterval}&limit=${limit}`;
  const json = await httpGet(url);
  if (json.code !== "0") throw new Error(`OKX error ${json.code}: ${json.msg}`);
  const arr = json.data;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("OKX returned empty data");
  // OKX returns newest first: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  return arr
    .map((k) => ({
      time: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
      low:  Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
    }))
    .sort((a, b) => a.time - b.time);
}

const FETCHERS = {
  bingx:   fetchKlinesBingX,
  binance: fetchKlinesBinance,
  bybit:   fetchKlinesBybit,
  okx:     fetchKlinesOKX,
};

// ── BingX Positions ──────────────────────────────────────
// Docs: https://bingx-api.github.io/docs/#/swapV2/account-api.html
async function fetchBingXPositions() {
  if (!BINGX_API_KEY || !BINGX_API_SECRET) return null;
  const ts = Date.now().toString();
  const binSymbol = SYMBOL.replace("-", "");
  const recvWindow = "10000";
  const query = `symbol=${binSymbol}&timestamp=${ts}&recvWindow=${recvWindow}`;
  const crypto = require("node:crypto");
  const sign = crypto.createHmac("sha256", BINGX_API_SECRET).update(query).digest("hex");
  const url = `${BINGX_BASE}/openApi/swap/v2/user/balance?${query}&signature=${sign}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  let json;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 btc-sniper-bot/1.0",
        "X-BX-APIKEY": BINGX_API_KEY,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(t);
  }

  if (json.code !== 0) throw new Error(`BingX positions error ${json.code}: ${json.msg}`);
  return json.data;
}

// ── BingX positions state ────────────────────────────────
let latestPositions = null;

// ── Dispatch: fixed source, or auto-fallback through the list ─
async function fetchKlines(symbol, interval, limit = KLINE_LIMIT) {
  if (DATA_SOURCE !== "auto") {
    const fn = FETCHERS[DATA_SOURCE];
    if (!fn) throw new Error(`Unknown DATA_SOURCE='${DATA_SOURCE}'`);
    activeSource = DATA_SOURCE;
    return fn(symbol, interval, limit);
  }
  // Auto mode: try the one that worked last first, then the rest.
  const order = activeSource
    ? [activeSource, ...FALLBACK_ORDER.filter((s) => s !== activeSource)]
    : FALLBACK_ORDER;
  const errors = [];
  for (const src of order) {
    try {
      const data = await FETCHERS[src](symbol, interval, limit);
      if (activeSource !== src) {
        console.log(`✨ Data source → ${src.toUpperCase()}`);
        activeSource = src;
      }
      return data;
    } catch (e) {
      errors.push(`${src}: ${e.message}`);
    }
  }
  throw new Error(`all sources failed\n   ${errors.join("\n   ")}`);
}

// ── Indicators (EMA, RSI, structure, S/R) ─────────────────────
function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// Compare last 10 vs previous 10 bars to label market structure
function detectStructure(highs, lows) {
  const n = highs.length;
  if (n < 20) return "NA";
  const recentH = highs.slice(-10), recentL = lows.slice(-10);
  const priorH  = highs.slice(-20, -10), priorL = lows.slice(-20, -10);
  const hh = Math.max(...recentH) > Math.max(...priorH);
  const hl = Math.min(...recentL) > Math.min(...priorL);
  const lh = Math.max(...recentH) < Math.max(...priorH);
  const ll = Math.min(...recentL) < Math.min(...priorL);
  if (hh && hl) return "HH";
  if (lh && ll) return "LL";
  if (hh) return "HH";
  if (ll) return "LL";
  if (lh) return "LH";
  if (hl) return "HL";
  return "NA";
}

const round = (v, d = 2) =>
  v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

function buildMarketPayload(candles) {
  const last = candles[candles.length - 1];
  const closes = candles.map((c) => c.close);
  const highs  = candles.map((c) => c.high);
  const lows   = candles.map((c) => c.low);

  const last20 = candles.slice(-20);
  const support    = Math.min(...last20.map((c) => c.low));
  const resistance = Math.max(...last20.map((c) => c.high));

  return {
    pair:       SYMBOL.replace("-", ""),
    timeframe:  INTERVAL,
    open:       last.open,
    high:       last.high,
    low:        last.low,
    close:      last.close,
    volume:     round(last.volume, 4),
    ema20:      round(ema(closes, 20)),
    ema50:      round(ema(closes, 50)),
    ema200:     round(ema(closes, 200)),
    rsi:        round(rsi(closes, 14)),
    structure:  detectStructure(highs, lows),
    support:    round(support),
    resistance: round(resistance),
    barTime:    last.time,
    timestamp:  new Date(last.time).toISOString(),
  };
}

// ── GPT-4o-mini Analysis ───────────────────────────────────────
async function analyzeWithGPT(payload) {
  const systemPrompt = `You are an elite crypto trading AI focused on BTCUSDT using smart money concepts.

Your priority is to trade ONLY at extreme levels (support/resistance) and strictly AVOID mid-range entries.

---

## INPUT

* OHLC
* EMA 20 / 50 / 200
* RSI (14)
* Market structure (HH, HL, LH, LL)
* Support & Resistance

---

## CORE RULE (CRITICAL)

Define:

* support
* resistance
* mid_range = between support and resistance

If price is inside mid_range:
→ RETURN FULL JSON with:

* decision_now = "SKIP"
* reason = "price in mid-range no trade zone"

NO exceptions.

---

## MARKET CLASSIFICATION

* "trend" → clear HH/HL or LH/LL
* "range" → sideways
* "impulse" → strong breakout

---

## LIQUIDITY LOGIC

Detect:

* sweep_high → breakout above resistance but closes below
* sweep_low → breakdown below support but closes above

---

## VALID ENTRY CONDITIONS

### SNIPER SHORT (TOP ONLY)

* price near resistance (top 10–15% of range)
* sweep_high OR rejection
* bearish confirmation

### SNIPER LONG (BOTTOM ONLY)

* price near support (bottom 10–15% of range)
* sweep_low OR bounce
* bullish confirmation

---

## INVALID CONDITIONS (FORCE SKIP)

* price in middle of range
* RSI 45–55 and no structure
* EMA compressed (no direction)
* no liquidity event

---

## ENTRY FORMAT

Use ONLY:
"entry_zone": ["low", "high"]

---

## RISK RULE

Only allow trade if:

* Risk/Reward ≥ 1.5

Else:
→ SKIP

---

## OUTPUT FORMAT (STRICT JSON)

{
"market_condition": "trend|range|impulse",
"bias": "bullish|bearish|neutral",
"liquidity_event": "sweep_high|sweep_low|none",

"no_trade_zone": ["support", "resistance"],

"sniper_long": {
"entry_zone": ["low", "high"],
"tp": ["tp1", "tp2"],
"sl": "price"
},

"sniper_short": {
"entry_zone": ["low", "high"],
"tp": ["tp1", "tp2"],
"sl": "price"
},

"decision_now": "LONG|SHORT|SKIP",
"confidence": "high|medium|low",
"reason": "clear explanation"
}

---

## FINAL GOAL

Act like a sniper:

* Wait for price at extremes
* Avoid mid-range traps
* Trade only high-probability setups`;

  const userPrompt = `Analyze this BTCUSDT market data and generate trading signals:
${JSON.stringify(payload, null, 2)}

Return this exact JSON structure:
{
  "market_condition": "trend|range|impulse",
  "bias": "bullish|bearish|neutral",
  "no_trade_zone": ["price_low", "price_high"],
  "long_safe": { "entry_zone": ["price_low", "price_high"], "tp": ["tp1", "tp2"], "sl": "price" },
  "short_safe": { "entry_zone": ["price_low", "price_high"], "tp": ["tp1", "tp2"], "sl": "price" },
  "sniper_long": { "entry_zone": ["price_low", "price_high"], "tp": ["tp1", "tp2"], "sl": "price" },
  "sniper_short": { "entry_zone": ["price_low", "price_high"], "tp": ["tp1", "tp2"], "sl": "price" },
  "decision_now": "LONG|SHORT|SKIP",
  "confidence": "high|medium|low",
  "reason": "short explanation"
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 800,
  });

  const raw = completion.choices[0].message.content.trim();
  const clean = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error("❌ JSON parse error:", clean.slice(0, 200));
    return {
      market_condition: "range",
      bias: "neutral",
      liquidity_event: "none",
      no_trade_zone: [0, 0],
      long_safe: {},
      short_safe: {},
      sniper_long: {},
      sniper_short: {},
      decision_now: "SKIP",
      confidence: "low",
      reason: "parse error fallback"
    };
  }
}

// ── Main tick: poll BingX, broadcast, run GPT on new bar ──────
async function tick() {
  try {
    const candles = await fetchKlines(SYMBOL, INTERVAL, KLINE_LIMIT);
    if (candles.length < 200) {
      console.warn(`⚠️  Only ${candles.length} candles — need 200+ for EMA200`);
      return;
    }

    const payload = buildMarketPayload(candles);

    const rangePercent = (payload.resistance - payload.support) / payload.close;
    if (rangePercent < 0.0015) {
      console.log(`⚠️  Range too tight (${(rangePercent * 100).toFixed(2)}%) — skip`);
      return;
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    payload.sweep_high = last.high > prev.high && last.close < prev.high;
    payload.sweep_low  = last.low < prev.low && last.close > prev.low;
    latestPayload = { ...payload, receivedAt: new Date().toISOString() };
    broadcast({ type: "market_data", data: latestPayload });

    // Run GPT only when a new bar closes (avoids spamming OpenAI every poll)
    if (payload.barTime === lastAnalyzedBarTime) {
      process.stdout.write(".");
      return;
    }
    lastAnalyzedBarTime = payload.barTime;

    console.log(`\n📊 New ${INTERVAL} bar — ${payload.pair} @ ${payload.close}`);
    console.log("🤖 Analyzing with GPT-4o-mini...");

    const midLow = payload.support + (payload.resistance - payload.support) * 0.3;
    const midHigh = payload.resistance - (payload.resistance - payload.support) * 0.3;
    let signal;
    if (payload.close > midLow && payload.close < midHigh) {
      console.log(`⚠️  Mid-range filter active (${payload.close} between ${midLow}–${midHigh})`);
      signal = {
        market_condition: "range",
        bias: "neutral",
        liquidity_event: "none",
        no_trade_zone: [payload.support, payload.resistance],
        sniper_long: {},
        sniper_short: {},
        decision_now: "SKIP",
        confidence: "low",
        reason: "mid-range filter active"
      };
    } else {
      signal = await analyzeWithGPT(payload);
    }

    if (signal.confidence === "low") {
      signal.decision_now = "SKIP";
      console.log("⚠️  Confidence low — auto SKIP");
    }

    const entry =
      signal?.sniper_long?.entry_zone?.[0] ||
      signal?.sniper_short?.entry_zone?.[0] ||
      signal?.long_safe?.entry_zone?.[0] ||
      signal?.short_safe?.entry_zone?.[0];
    const tp =
      signal?.sniper_long?.tp?.[0] ||
      signal?.sniper_short?.tp?.[0] ||
      signal?.long_safe?.tp?.[0] ||
      signal?.short_safe?.tp?.[0];
    const sl =
      signal?.sniper_long?.sl ||
      signal?.sniper_short?.sl ||
      signal?.long_safe?.sl ||
      signal?.short_safe?.sl;
    if (entry && tp && sl) {
      const risk = Math.abs(entry - sl) / entry;
      const reward = Math.abs(tp - entry) / entry;
      if (reward / risk < 1.3) {
        signal.decision_now = "SKIP";
        console.log(`⚠️  RR too low (${(reward / risk).toFixed(2)}) — skip`);
      }
    }
    if (entry && tp) {
      const movePercent = Math.abs(tp - entry) / entry;
      if (movePercent < 0.003) {
        signal.decision_now = "SKIP";
        console.log(`⚠️  Move too small (${(movePercent * 100).toFixed(2)}%) — skip`);
      }
    }
    if (signal.decision_now === "LONG" && tp < entry) {
      signal.decision_now = "SKIP";
      console.log("⚠️  Invalid LONG TP — skip");
    }
    if (signal.decision_now === "SHORT" && tp > entry) {
      signal.decision_now = "SKIP";
      console.log("⚠️  Invalid SHORT TP — skip");
    }

    // Fetch BingX positions
    try {
      const positions = await fetchBingXPositions();
      if (positions) {
        latestPositions = positions;
        broadcast({ type: "positions", data: latestPositions });
      }
    } catch (e) {
      console.warn("⚠️  Positions fetch failed:", e.message);
    }

    signal.timestamp = new Date().toISOString();
    signal.price = payload.close;
    signal.pair  = payload.pair;
    signal.source = activeSource || DATA_SOURCE;

    latestSignal = signal;
    signalHistory.unshift(signal);
    if (signalHistory.length > 50) signalHistory.pop();

    console.log(`✅ ${signal.decision_now} | bias: ${signal.bias} | ${signal.reason}`);

    broadcast({ type: "signal",  data: signal });
    broadcast({ type: "history", data: signalHistory });
  } catch (err) {
    console.error(`\n❌ Tick error: ${err.message}`);
  }
}

// ── POST /simulate — manual test (no BingX call) ──────────────
app.post("/simulate", async (req, res) => {
  try {
    // Use input price → fallback to latest real price from BingX → last resort default.
    const price = Number(req.body?.price) || latestPayload?.close || 70000;
    const rsi = Number(req.body?.rsi) || 57.2;
    const structure = req.body?.structure || "HH";

    const payload = {
      pair: SYMBOL.replace("-", ""),
      timeframe: INTERVAL,
      open:       round(price * 0.998),
      high:       round(price * 1.008),
      low:        round(price * 0.992),
      close:      round(price),
      volume:     2345.6,
      ema20:      round(price * 0.998),
      ema50:      round(price * 0.988),
      ema200:     round(price * 0.93),
      rsi,
      structure,
      support:    round(price * 0.99),
      resistance: round(price * 1.01),
      timestamp: new Date().toISOString(),
    };
    const signal = await analyzeWithGPT(payload);
    signal.timestamp = new Date().toISOString();
    signal.price = payload.close;
    signal.pair  = "BTCUSDT";
    signal.source = "simulate";

    latestSignal = signal;
    signalHistory.unshift(signal);
    if (signalHistory.length > 50) signalHistory.pop();

    broadcast({ type: "market_data", data: payload });
    broadcast({ type: "signal",  data: signal });
    broadcast({ type: "history", data: signalHistory });
    res.json({ success: true, signal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /refresh — force an immediate poll & analysis ────────
app.post("/refresh", async (req, res) => {
  lastAnalyzedBarTime = 0; // force GPT run
  await tick();
  res.json({ success: true, signal: latestSignal, market_data: latestPayload });
});

// ── GET /signal ───────────────────────────────────────────────
app.get("/signal", (req, res) => {
  res.json({ signal: latestSignal, market_data: latestPayload });
});

// ── GET /history ──────────────────────────────────────────────
app.get("/history", (req, res) => {
  res.json(signalHistory);
});

// ── GET /diag — connectivity test to all exchanges ────────────
app.get("/diag", async (_req, res) => {
  const out = {
    node: process.version,
    config_source: DATA_SOURCE,
    active_source: activeSource,
    tests: [],
  };
  const noDash = SYMBOL.replace("-", "");
  const endpoints = [
    ["bingx",   `${BINGX_BASE}/openApi/swap/v2/quote/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=1`],
    ["binance", `${BINANCE_BASE}/fapi/v1/klines?symbol=${noDash}&interval=${INTERVAL}&limit=1`],
    ["bybit",   `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${noDash}&interval=15&limit=1`],
    ["okx",     `${OKX_BASE}/api/v5/market/candles?instId=${SYMBOL}-SWAP&bar=${INTERVAL}&limit=1`],
  ];
  for (const [src, url] of endpoints) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { "User-Agent": "btc-sniper-bot/1.0" } });
      const text = await r.text();
      out.tests.push({ source: src, url, status: r.status, ms: Date.now() - t0, body: text.slice(0, 200) });
    } catch (e) {
      out.tests.push({
        source: src, url, ok: false, ms: Date.now() - t0,
        error: e.message,
        cause_code: e.cause?.code,
      });
    }
  }
  res.json(out);
});

// ── GET /health ───────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    source_config: DATA_SOURCE,
    source_active: activeSource,
    symbol: SYMBOL,
    interval: INTERVAL,
    poll_ms: POLL_MS,
    signals_processed: signalHistory.length,
    last_bar_time: lastAnalyzedBarTime
      ? new Date(lastAnalyzedBarTime).toISOString()
      : null,
    bingx_configured: !!(BINGX_API_KEY && BINGX_API_SECRET),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /positions ───────────────────────────────────────
app.get("/positions", async (req, res) => {
  try {
    const positions = await fetchBingXPositions();
    latestPositions = positions;
    res.json({ success: true, data: positions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start server & begin polling ──────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════╗
║       BTC SNIPER BOT — Backend (BingX)         ║
╠════════════════════════════════════════════════╣
║  Dashboard→ http://localhost:${PORT}              ║
║  WS       → ws://localhost:${PORT}                ║
║  Source   → ${(DATA_SOURCE === "auto" ? "AUTO (bybit→okx→binance→bingx)" : DATA_SOURCE.toUpperCase()).padEnd(34)}   ║
║  Symbol   → ${SYMBOL.padEnd(34)}   ║
║  Timeframe→ ${INTERVAL.padEnd(34)}   ║
║  Poll     → every ${(POLL_MS / 1000).toString().padEnd(24)}s    ║
║                                                ║
║  /signal  → GET   latest signal                ║
║  /history → GET   last 50 signals              ║
║  /health  → GET   server status                ║
║  /refresh → POST  force re-analyze now         ║
║  /simulate→ POST  mock data (dev)              ║
╚════════════════════════════════════════════════╝
`);
  await tick();
  setInterval(tick, POLL_MS);
});
