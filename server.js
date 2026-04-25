// ============================================================
// BTC SNIPER BOT — Pure Sniper Engine (No AI)
// Deterministic rule-based trading signals
// Polls exchange klines → computes indicators → sniper engine
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Serve the dashboard (index.html + any assets in project root)
app.use(express.static(path.join(__dirname)));

// ── Config ─────────────────────────────────────────────────────
// DATA_SOURCE: bybit | okx | binance | bingx | auto (tries each in order)
const DATA_SOURCE = (process.env.DATA_SOURCE || "auto").toLowerCase();
const FALLBACK_ORDER = ["bybit", "okx", "binance", "bingx"];

const SYMBOL = process.env.SYMBOL || "BTC-USDT";              // dash format; auto-converted per exchange
const INTERVAL = process.env.INTERVAL || "15m";
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);
const KLINE_LIMIT = 250;                                      // enough for EMA200

// ── Fixed Risk Execution Model ─────────────────────────────
const FIXED_MARGIN = 5;                                       // USD per trade
const LEVERAGE = 150;                                         // x leverage
const TP_MULTIPLIER = 1.0;                                    // 100% profit on margin
const DRY_RUN = (process.env.DRY_RUN || "false").toLowerCase() === "true";

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

// ── Daily Trade Limit ─────────────────────────────────────────
let tradeCountToday = 0;
let lastTradeDate = new Date().toDateString();
const MAX_TRADES_PER_DAY = 5;

function checkDailyLimit() {
  const today = new Date().toDateString();
  if (today !== lastTradeDate) {
    tradeCountToday = 0;
    lastTradeDate = today;
  }
  return tradeCountToday < MAX_TRADES_PER_DAY;
}

// ── WebSocket broadcast ────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

// ── Bot Logger ─────────────────────────────────────────────
function botLog(level, message) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level, message };
  console.log(`[${level.toUpperCase()}] ${message}`);
  broadcast({ type: "log", data: logEntry });
}

wss.on("connection", (ws) => {
  console.log("📡 Dashboard connected");
  botLog("info", "📡 Dashboard connected");
  if (latestPayload) ws.send(JSON.stringify({ type: "market_data", data: latestPayload }));
  if (latestSignal)  ws.send(JSON.stringify({ type: "signal", data: latestSignal }));
  if (signalHistory.length) ws.send(JSON.stringify({ type: "history", data: signalHistory }));
  if (latestPositions) ws.send(JSON.stringify({ type: "positions", data: latestPositions }));
  if (dryTrades.length) ws.send(JSON.stringify({ type: "dry_trades", data: dryTrades }));
  if (dryTradesHistory.length) ws.send(JSON.stringify({ type: "dry_history", data: dryTradesHistory }));
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

// ══════════════════════════════════════════════════════════════
// PURE SNIPER ENGINE — No AI, Deterministic Rules
// ══════════════════════════════════════════════════════════════

// ── Session Filter ────────────────────────────────────────────
function isTradingSession(utcHour) {
  return utcHour >= 6 && utcHour < 23;
}

// ── Market Structure Detection ─────────────────────────────────
function detectStructure(highs, lows) {
  if (highs.length < 20 || lows.length < 20) return "NA";
  const recentH = highs.slice(-10), recentL = lows.slice(-10);
  const priorH  = highs.slice(-20, -10), priorL = lows.slice(-20, -10);
  const maxRH = Math.max(...recentH), maxRL = Math.min(...recentL);
  const maxPH = Math.max(...priorH), maxPL = Math.min(...priorL);
  const minRH = Math.min(...recentH), minRL = Math.min(...recentL);
  const minPH = Math.min(...priorH), minPL = Math.min(...priorL);
  if (maxRH > maxPH && maxRL > maxPL) return "HH";
  if (maxRH < maxPH && maxRL < maxPL) return "LL";
  if (maxRH > maxPH) return "LH";
  if (maxRL < maxPL) return "HL";
  return "NA";
}

// ── Candle Trigger Detection ───────────────────────────────────
function getCandleTrigger(candle) {
  const body      = Math.abs(candle.close - candle.open);
  const range    = candle.high - candle.low;
  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;
  const isBullish = candle.close > candle.open;
  const isBearish = candle.close < candle.open;

  if (range === 0) return null;

  const upperWickPct = upperWick / range;
  const lowerWickPct = lowerWick / range;
  const bodyPct = body / range;

  let trigger = null;
  if (isBearish && upperWickPct > 0.4 && bodyPct < 0.6) {
    trigger = "SHORT";
  } else if (isBullish && lowerWickPct > 0.4 && bodyPct < 0.6) {
    trigger = "LONG";
  }

  return trigger;
}

// ── Candle Detail Analyzer ─────────────────────────────────────
function getCandleDetail(candle) {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;

  if (range === 0) return null;

  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;

  return {
    isBull: candle.close > candle.open,
    isBear: candle.close < candle.open,
    bodyPct: body / range,
    upperWickPct: upperWick / range,
    lowerWickPct: lowerWick / range
  };
}

// ── Entry Confirmation Engine ─────────────────────────────────
function confirmEntry(signal, payload) {
  if (signal.decision_now === "SKIP") return signal;

  const last = payload.lastCandle;
  const prev = payload.prevCandle;

  const c = getCandleDetail(last);
  const p = getCandleDetail(prev);

  if (!c || !p) return signal;

  let valid = false;
  let reason = "";

  if (signal.decision_now === "LONG") {
    const rejection =
      c.lowerWickPct > 0.4 &&
      c.bodyPct < 0.6 &&
      c.isBull;

    const engulfing =
      c.isBull &&
      p.isBear &&
      last.close > prev.open &&
      last.open < prev.close;

    if (rejection || engulfing) {
      valid = true;
      reason = rejection ? "bullish rejection" : "bullish engulfing";
    }
  }

  if (signal.decision_now === "SHORT") {
    const rejection =
      c.upperWickPct > 0.4 &&
      c.bodyPct < 0.6 &&
      c.isBear;

    const engulfing =
      c.isBear &&
      p.isBull &&
      last.open > prev.close &&
      last.close < prev.open;

    if (rejection || engulfing) {
      valid = true;
      reason = rejection ? "bearish rejection" : "bearish engulfing";
    }
  }

  if (!valid) {
    signal.decision_now = "SKIP";
    signal.reason = "no confirmation candle";
  } else {
    signal.reason += ` + ${reason}`;
  }

  return signal;
}

// ── HTF Bias (1H trend confirmation) ────────────────────────────
function getHTFBias(htf) {
  const price  = htf.close;
  const ema50  = htf.ema50;
  const ema200 = htf.ema200;
  const struct = htf.structure;

  if (price > ema50 && ema50 > ema200) return "LONG";
  if (price < ema50 && ema50 < ema200) return "SHORT";
  if (struct === "HH" || struct === "HL") return "LONG";
  if (struct === "LL" || struct === "LH") return "SHORT";
  return "NEUTRAL";
}

// ── Core Sniper Signal Generator ──────────────────────────────
function generateSniperSignal(payload) {
  const now = new Date();
  const utcHour = now.getUTCHours();

  const price     = payload.close;
  const support   = payload.support;
  const resist   = payload.resistance;
  const range    = resist - support;
  const topZone  = resist - range * 0.15;
  const botZone  = support + range * 0.15;
  const midLow   = support + range * 0.3;
  const midHigh  = resist - range * 0.3;

  const last   = payload.lastCandle;
  const prev  = payload.prevCandle;

  // Default SKIP response with both zones filled
  const defaultSignal = () => ({
    pair: payload.pair,
    decision_now: "SKIP",
    price,
    sniper_long: {
      entry_zone: [botZone - range * 0.05, botZone + range * 0.05],
      tp: [price + range * 0.5, price + range * 0.8],
      sl: support
    },
    sniper_short: {
      entry_zone: [topZone - range * 0.05, topZone + range * 0.05],
      tp: [price - range * 0.5, price - range * 0.8],
      sl: resist
    },
    confidence: "low",
    reason: "no valid trigger"
  });

  // 1. Session filter
  if (!isTradingSession(utcHour)) {
    const s = defaultSignal();
    s.reason = "outside trading session";
    return s;
  }

  // 2. Mid-range filter
  if (price > midLow && price < midHigh) {
    const s = defaultSignal();
    s.reason = "price in mid-range no trade zone";
    return s;
  }

  // 3. Min range filter (avoid noise scalping)
  if (range / price < 0.003) {
    const s = defaultSignal();
    s.reason = "low range market";
    return s;
  }

  // 4. Candle trigger
  const trigger = getCandleTrigger(last);

  // 5. Determine direction based on zones + trigger (trigger REQUIRED)
  let decision = "SKIP";
  let reason = "no valid trigger at key level";

  if (trigger === "LONG" && price <= botZone + range * 0.05) {
    decision = "LONG";
    reason = "bullish trigger at bottom zone";
  } else if (trigger === "SHORT" && price >= topZone - range * 0.05) {
    decision = "SHORT";
    reason = "bearish trigger at top zone";
  } else {
    decision = "SKIP";
    reason = "no trigger at key level";
  }

  // Build entry zones (wider for better market hit)
  const slBuffer = range * 0.1;
  const entryZoneLongHigh  = botZone + range * 0.05;
  const entryZoneLongLow   = botZone - range * 0.05;
  const tp1Long = price + range * 0.5;
  const tp2Long = price + range * 0.8;
  const slLong  = support - slBuffer;

  const entryZoneShortHigh = topZone + range * 0.05;
  const entryZoneShortLow  = topZone - range * 0.05;
  const tp1Short = price - range * 0.5;
  const tp2Short = price - range * 0.8;
  const slShort  = resist + slBuffer;

  const signal = {
    pair: payload.pair,
    decision_now: decision,
    price,
    sniper_long: {
      entry_zone: [round(entryZoneLongLow), round(entryZoneLongHigh)],
      tp: [round(tp1Long), round(tp2Long)],
      sl: round(slLong)
    },
    sniper_short: {
      entry_zone: [round(entryZoneShortLow), round(entryZoneShortHigh)],
      tp: [round(tp1Short), round(tp2Short)],
      sl: round(slShort)
    },
    confidence: "low",
    reason
  };

  return signal;
}

// ── Validate Signal (RR, entry, direction) ─────────────────────
function validateSignal(signal) {
  if (signal.decision_now === "SKIP") return signal;

  const isLong  = signal.decision_now === "LONG";
  const entryZone = isLong ? signal.sniper_long.entry_zone : signal.sniper_short.entry_zone;
  const entry   = (entryZone[0] + entryZone[1]) / 2;
  const tp      = isLong ? signal.sniper_long.tp[0] : signal.sniper_short.tp[0];
  const sl      = isLong ? signal.sniper_long.sl : signal.sniper_short.sl;

  if (!entry || !tp || !sl) {
    signal.decision_now = "SKIP";
    signal.reason += " | missing entry/tp/sl";
    return signal;
  }

  // RR check
  const risk    = Math.abs(entry - sl) / entry;
  const reward  = Math.abs(tp - entry) / entry;
  const rr      = reward / risk;

  if (rr < 1.5) {
    signal.decision_now = "SKIP";
    signal.reason += ` | RR too low ${rr.toFixed(2)}`;
    return signal;
  }

  // SL distance filter (critical for 150x leverage)
  const slDist = Math.abs(entry - sl) / entry;
  if (slDist < 0.002) {
    signal.decision_now = "SKIP";
    signal.reason += " | SL too tight";
    return signal;
  }

  // Direction check
  if (isLong && tp < entry) {
    signal.decision_now = "SKIP";
    signal.reason += " | invalid LONG TP";
  } else if (!isLong && tp > entry) {
    signal.decision_now = "SKIP";
    signal.reason += " | invalid SHORT TP";
  }

  signal.confidence = rr >= 1.8 ? "high" : "medium";
  if (signal.confidence === "medium") {
    signal.reason += " | medium confidence";
  }
  return signal;
}

// ── Cooldown System ────────────────────────────────────────────
let lastTradeTime = 0;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

function checkCooldown(signal) {
  if (signal.decision_now === "SKIP") return signal;
  const now = Date.now();
  if (now - lastTradeTime < COOLDOWN_MS) {
    signal.decision_now = "SKIP";
    signal.reason = "cooldown active";
  }
  return signal;
}

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
  const url = `${BINGX_BASE}/openApi/swap/v2/user/positions?${query}&signature=${sign}`;

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

// ── BingX Place Order ─────────────────────────────────────
// Docs: https://bingx-api.github.io/docs/#/swapV2/trade-api.html
async function placeBingXOrder(side, entryZone, tp, sl) {
  if (!BINGX_API_KEY || !BINGX_API_SECRET) return null;
  const ts = Date.now().toString();
  const binSymbol = SYMBOL.replace("-", "");
  const recvWindow = "10000";

  // Fixed margin execution
  const midPrice = (entryZone[0] + entryZone[1]) / 2;
  const zoneWidth = Math.abs(entryZone[1] - entryZone[0]);
  const rangePct = zoneWidth / midPrice;
  const spreadFactor = rangePct > 0.005 ? 1.0005 : 1.0002;
  const entry = side === "LONG"
    ? midPrice * spreadFactor
    : midPrice * (2 - spreadFactor);

  const positionValue = FIXED_MARGIN * LEVERAGE;
  const profitPct = FIXED_MARGIN / positionValue;
  const calculatedTp = side === "LONG"
    ? entry * (1 + profitPct)
    : entry * (1 - profitPct);
  const quantity = positionValue / entry;

  const riskAmount = Math.abs(entry - sl) * quantity;
  const profitAmount = (calculatedTp - entry) * quantity;

  console.log(`
🎯 FIXED RISK EXECUTION:
  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}
  Side: ${side}
  Entry: ${round(entry, 4)} | TP: ${round(calculatedTp, 4)} | SL: ${round(sl, 4)}
  Margin: $${FIXED_MARGIN} | Leverage: ${LEVERAGE}x | Position: $${positionValue}
  Quantity: ${round(quantity, 6)} BTC
  Profit Target: $${round(profitAmount, 2)} | Risk: $${round(riskAmount, 2)} | RR: ${(profitAmount / riskAmount).toFixed(2)}
  Profit %: ${(profitPct * 100).toFixed(3)}%
`);

  const params = `symbol=${binSymbol}&side=${side}&positionSide=${side === "LONG" ? "LONG" : "SHORT"}&orderType=LIMIT&quantity=${quantity}&price=${entry}&stopLossPrice=${sl}&timestamp=${ts}&recvWindow=${recvWindow}`;
  const crypto = require("node:crypto");
  const sign = crypto.createHmac("sha256", BINGX_API_SECRET).update(params).digest("hex");
  const url = `${BINGX_BASE}/openApi/swap/v2/trade/order?${params}&signature=${sign}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  let json;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 btc-sniper-bot/1.0",
        "X-BX-APIKEY": BINGX_API_KEY,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(t);
  }

  if (json.code !== 0) throw new Error(`BingX order error ${json.code}: ${json.msg}`);
  return json.data;
}

// ── Dry Run Simulator ────────────────────────────────────
let dryRunActive = false;
const DRY_BALANCE = 100;
const DRY_MARGIN = 5;
const DRY_LEVERAGE = 150;
const DRY_TP_PCT = 1.0; // 100% take profit (double)

let dryTrades = [];
let dryTradesHistory = [];

function simulateDryTrade(signal, payload) {
  if (!dryRunActive) return;
  if (signal.decision_now !== "LONG" && signal.decision_now !== "SHORT") return;

  const side = signal.decision_now;
  let entryZone, sl;

  if (side === "LONG") {
    entryZone = signal.sniper_long?.entry_zone;
    sl = signal.sniper_long?.sl;
  } else if (side === "SHORT") {
    entryZone = signal.sniper_short?.entry_zone;
    sl = signal.sniper_short?.sl;
  }

  if (!entryZone || !sl) {
    console.log("⚠️  Dry run: missing entry zone/sl");
    return;
  }

  // Fixed margin calculation (same as placeBingXOrder)
  const midPrice = (entryZone[0] + entryZone[1]) / 2;
  const zoneWidth = Math.abs(entryZone[1] - entryZone[0]);
  const rangePct = zoneWidth / midPrice;
  const spreadFactor = rangePct > 0.005 ? 1.0005 : 1.0002;
  const entry = side === "LONG"
    ? midPrice * spreadFactor
    : midPrice * (2 - spreadFactor);

  const positionValue = FIXED_MARGIN * LEVERAGE;
  const profitPct = FIXED_MARGIN / positionValue;
  const tp = side === "LONG"
    ? entry * (1 + profitPct)
    : entry * (1 - profitPct);
  const quantity = positionValue / entry;

  const riskPct = Math.abs(entry - sl) / entry;
  const tpPct = Math.abs(tp - entry) / entry;
  const pnlIfWin = FIXED_MARGIN;
  const pnlIfLose = positionValue * riskPct;
  const rr = pnlIfWin / pnlIfLose;

  const trade = {
    id: Date.now(),
    side,
    entry: round(entry, 4),
    tp: round(tp, 4),
    sl: round(sl, 4),
    positionValue,
    margin: FIXED_MARGIN,
    leverage: LEVERAGE,
    riskPct: (riskPct * 100).toFixed(3) + "%",
    tpPct: (profitPct * 100).toFixed(3) + "%",
    rr: rr.toFixed(2),
    pnlIfWin: pnlIfWin.toFixed(2),
    pnlIfLose: pnlIfLose.toFixed(2),
    balance: DRY_BALANCE,
    result: "OPEN",
    timestamp: new Date().toISOString(),
    pair: payload.pair,
    price: payload.close,
    signal_reason: signal.reason,
  };

  dryTrades.push(trade);
  botLog("ok", `🎯 DRY TRADE OPENED | ${side} @ ${round(entry, 4)} | TP: ${round(tp, 4)} | SL: ${round(sl, 4)} | Pos: $${positionValue} | RR: ${rr.toFixed(2)}`);

  broadcast({ type: "dry_trade", data: trade });
  broadcast({ type: "dry_trades", data: dryTrades });
}

// ── Auto-check dry trades against current price ───────────
function checkDryTrades(currentPrice) {
  if (!dryRunActive) return;
  if (dryTrades.length === 0) return;

  const toClose = [];

  dryTrades.forEach(trade => {
    const { side, entry, tp, sl } = trade;

    let hitTP = false;
    let hitSL = false;

    if (side === "LONG") {
      hitTP = currentPrice >= tp;
      hitSL = currentPrice <= sl;
    } else if (side === "SHORT") {
      hitTP = currentPrice <= tp;
      hitSL = currentPrice >= sl;
    }

    if (hitTP) {
      botLog("ok", `✅ TP HIT | ${side} @ ${currentPrice} | Profit: +$${trade.pnlIfWin}`);
      toClose.push({ tradeId: trade.id, result: "WIN" });
    } else if (hitSL) {
      botLog("warn", `🛑 SL HIT | ${side} @ ${currentPrice} | Loss: -$${trade.pnlIfLose}`);
      toClose.push({ tradeId: trade.id, result: "LOSE" });
    }
  });

  toClose.forEach(({ tradeId, result }) => closeDryTrade(tradeId, result));
}

function closeDryTrade(tradeId, result) {
  const idx = dryTrades.findIndex(t => t.id === tradeId);
  if (idx === -1) return;

  const trade = dryTrades[idx];
  const tp = trade.tp;
  const sl = trade.sl;
  const entry = trade.entry;
  const side = trade.side;
  const tpPct = Math.abs(tp - entry) / entry;
  const riskPct = Math.abs(entry - sl) / entry;
  const pnl = result === "WIN"
    ? trade.positionValue * tpPct
    : -trade.positionValue * riskPct;

  trade.result = result;
  trade.pnl = pnl.toFixed(2);
  trade.closedAt = new Date().toISOString();
  trade.balanceAfter = (DRY_BALANCE + pnl).toFixed(2);

  console.log(`\n🎯 DRY RUN TRADE ${result}`);
  console.log(`   PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} | Balance after: $${trade.balanceAfter}`);

  dryTradesHistory.unshift(trade);
  dryTrades.splice(idx, 1);
  broadcast({ type: "dry_trade", data: trade });
  broadcast({ type: "dry_trades", data: dryTrades });
  broadcast({ type: "dry_history", data: dryTradesHistory });
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

const round = (v, d = 2) =>
  v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

function buildMarketPayload(candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
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
    lastCandle: last,
    prevCandle: prev,
  };
}

// ── Main tick: poll exchange, run sniper engine ────────────
async function tick() {
  try {
    const [candles15m, candles1h] = await Promise.all([
      fetchKlines(SYMBOL, "15m", KLINE_LIMIT),
      fetchKlines(SYMBOL, "1h",  KLINE_LIMIT),
    ]);
    if (candles15m.length < 20) {
      console.warn(`⚠️  Only ${candles15m.length} candles`);
      return;
    }

    const payload15m = buildMarketPayload(candles15m);
    const payload1h  = buildMarketPayload(candles1h);
    latestPayload = { ...payload15m, receivedAt: new Date().toISOString() };
    broadcast({ type: "market_data", data: latestPayload });

    if (payload15m.barTime === lastAnalyzedBarTime) {
      process.stdout.write(".");
      return;
    }
    lastAnalyzedBarTime = payload15m.barTime;

    botLog("info", `📊 New 15m bar — ${payload15m.pair} @ ${payload15m.close} | Structure: ${payload15m.structure}`);

    let signal = generateSniperSignal(payload15m);

    // 1. Entry confirmation FIRST (before RR calc)
    signal = confirmEntry(signal, payload15m);
    if (signal.decision_now !== "SKIP") {
      botLog("info", `✅ Entry confirmed: ${signal.reason}`);
    }

    // 2. Validate (RR check)
    signal = validateSignal(signal);
    if (signal.decision_now === "SKIP") {
      botLog("warn", `❌ Validation failed: ${signal.reason}`);
    }
    signal = checkCooldown(signal);
    if (signal.decision_now === "SKIP" && signal.reason === "cooldown active") {
      botLog("warn", `⏳ Cooldown active - next trade available in ${Math.ceil((lastTradeTime + COOLDOWN_MS - Date.now()) / 1000)}s`);
    }

    const htfBias = getHTFBias(payload1h);
    signal.htf_bias = htfBias;
    signal.htf_timeframe = "1H";
    signal.htf_structure = payload1h.structure;

    // 3. HTF filter — only reject if OPPOSITE direction
    if (
      (signal.decision_now === "LONG" && htfBias === "SHORT") ||
      (signal.decision_now === "SHORT" && htfBias === "LONG")
    ) {
      signal.decision_now = "SKIP";
      signal.reason = `HTF mismatch (${htfBias})`;
    }

    // 3b. Anti fake breakout filter (weak momentum) — adaptive
    if (signal.decision_now !== "SKIP") {
      const momFilter = Math.abs(payload15m.close - payload15m.prevCandle.close) / payload15m.close;
      const range = payload15m.resistance - payload15m.support;
      const dynamicMomentum = (range / payload15m.close) * 0.2;
      if (momFilter < dynamicMomentum) {
        signal.decision_now = "SKIP";
        signal.reason = "weak momentum";
      }
    }

    // 4. Daily limit check
    if (signal.decision_now !== "SKIP" && !checkDailyLimit()) {
      signal.decision_now = "SKIP";
      signal.reason = "daily limit reached";
    }

    if (signal.decision_now !== "SKIP") {
      if (!DRY_RUN) {
        try {
          const positions = await fetchBingXPositions();
          const posList = positions?.positions || positions?.list || [];
          const hasPos = posList.some(p => Math.abs(p.positionAmt || p.size || 0) > 0);
          if (hasPos) {
            botLog("warn", "⚠️ Already have open position → skipping trade");
          } else {
            botLog("info", `🚀 EXECUTING ${signal.decision_now} TRADE | Margin: $${FIXED_MARGIN} | Leverage: ${LEVERAGE}x`);
            await placeBingXOrder(
              signal.decision_now,
              signal.decision_now === "LONG"
                ? signal.sniper_long.entry_zone
                : signal.sniper_short.entry_zone,
              signal.decision_now === "LONG"
                ? signal.sniper_long.tp
                : signal.sniper_short.tp,
              signal.decision_now === "LONG"
                ? signal.sniper_long.sl
                : signal.sniper_short.sl
            );
            lastTradeTime = Date.now();
            tradeCountToday++;
            botLog("ok", `✅ TRADE PLACED | Count today: ${tradeCountToday}/${MAX_TRADES_PER_DAY}`);
          }
        } catch (e) {
          botLog("err", `❌ Trade execution failed: ${e.message}`);
        }
      } else {
        botLog("info", `🧪 DRY RUN: Would execute ${signal.decision_now} | Entry zone: ${signal.decision_now === "LONG" ? signal.sniper_long.entry_zone : signal.sniper_short.entry_zone}`);
      }
    }

    signal.timestamp = new Date().toISOString();
    signal.price = payload15m.close;
    signal.pair = payload15m.pair;
    signal.source = activeSource || DATA_SOURCE;

    // Signal scoring
    let score = 0;
    if (signal.htf_bias === signal.decision_now) score++;
    if (signal.confidence === "high") score++;
    const momFilter = Math.abs(payload15m.close - payload15m.prevCandle.close) / payload15m.close;
    const range = payload15m.resistance - payload15m.support;
    const dynamicMomentum = (range / payload15m.close) * 0.2;
    if (momFilter > dynamicMomentum) score++;
    signal.score = score;

    if (signal.score < 2) {
      signal.decision_now = "SKIP";
      signal.reason += " | low score";
    }

    latestSignal = signal;
    signalHistory.unshift(signal);
    if (signalHistory.length > 50) signalHistory.pop();

    console.log(`✅ ${signal.decision_now} | ${signal.reason}`);
    console.log(`
🧠 SIGNAL DEBUG:
  Decision: ${signal.decision_now}
  Reason: ${signal.reason}
  HTF: ${signal.htf_bias} (${signal.htf_structure})
  Price: ${signal.price}
  Confidence: ${signal.confidence}
`);

    broadcast({ type: "signal",  data: signal });
    broadcast({ type: "history", data: signalHistory });

    simulateDryTrade(signal, payload15m);
    checkDryTrades(payload15m.close);

    try {
      const positions = await fetchBingXPositions();
      if (positions) {
        latestPositions = positions;
        broadcast({ type: "positions", data: latestPositions });
      }
    } catch (e) {
      console.warn("⚠️  Positions fetch failed:", e.message);
    }
  } catch (err) {
    console.error(`\n❌ Tick error: ${err.message}`);
  }
}

// ── POST /simulate — manual test ──────────────────────────────
app.post("/simulate", async (req, res) => {
  try {
    const price = Number(req.body?.price) || latestPayload?.close || 70000;
    const support = price * 0.99;
    const resist = price * 1.01;
    const last = { open: price * 0.998, high: price * 1.008, low: price * 0.992, close: price };
    const prev = { open: price * 0.996, high: price * 1.004, low: price * 0.988, close: price * 0.997 };

    const payload = {
      pair: SYMBOL.replace("-", ""),
      timeframe: INTERVAL,
      close: price,
      support,
      resistance: resist,
      lastCandle: last,
      prevCandle: prev,
      timestamp: new Date().toISOString(),
    };

    let signal = generateSniperSignal(payload);
    signal = validateSignal(signal);
    signal.timestamp = new Date().toISOString();
    signal.price = payload.close;
    signal.pair = "BTCUSDT";
    signal.source = "simulate";

    latestSignal = signal;
    signalHistory.unshift(signal);
    if (signalHistory.length > 50) signalHistory.pop();

    broadcast({ type: "market_data", data: payload });
    broadcast({ type: "signal", data: signal });
    broadcast({ type: "history", data: signalHistory });
    res.json({ success: true, signal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /refresh — force an immediate poll & analysis ────────
app.post("/refresh", async (req, res) => {
  lastAnalyzedBarTime = 0;
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

// ── GET /trades — dry run + live trade history ─────────────────
app.get("/trades", (req, res) => {
  res.json({
    mode: DRY_RUN ? "dry_run" : "live",
    open_trades: dryTrades,
    closed_trades: dryTradesHistory,
    total_closed: dryTradesHistory.length,
    wins: dryTradesHistory.filter(t => t.result === "WIN").length,
    losses: dryTradesHistory.filter(t => t.result === "LOSE").length,
    total_pnl: dryTradesHistory.reduce((sum, t) => sum + parseFloat(t.pnl || 0), 0).toFixed(2),
  });
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
    execution_mode: DRY_RUN ? "dry_run" : "live",
    fixed_margin: FIXED_MARGIN,
    leverage: LEVERAGE,
    tp_multiplier: TP_MULTIPLIER,
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

// ── POST /dryrun — toggle dry run mode ────────────────────
app.post("/dryrun", (req, res) => {
  const { action, tradeId, result } = req.body;
  if (action === "toggle") {
    dryRunActive = !dryRunActive;
    console.log(`🎮 Dry run ${dryRunActive ? "ACTIVATED" : "DEACTIVATED"}`);
    res.json({ success: true, dryRunActive });
  } else if (action === "close" && tradeId && result) {
    closeDryTrade(tradeId, result);
    res.json({ success: true });
  } else if (action === "status") {
    res.json({
      active: dryRunActive,
      balance: DRY_BALANCE,
      margin: DRY_MARGIN,
      leverage: DRY_LEVERAGE,
      tpPct: DRY_TP_PCT * 100 + "%",
      openTrades: dryTrades,
      history: dryTradesHistory,
    });
  } else {
    res.status(400).json({ error: "Invalid action" });
  }
});

// ── Start server & begin polling ──────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  botLog("ok", `🚀 BTC SNIPER BOT STARTED | Mode: ${DRY_RUN ? "🧪 DRY RUN" : "🚀 LIVE"}`);
  botLog("info", `⚙️ Config: Margin=$${FIXED_MARGIN} | Leverage=${LEVERAGE}x | Source=${DATA_SOURCE}`);
  botLog("info", `📊 Timeframe: ${INTERVAL} | Poll interval: ${POLL_MS}ms`);
  console.log(`
╔════════════════════════════════════════════════════════╗
║       BTC SNIPER BOT — Fixed Risk Execution Engine     ║
╠════════════════════════════════════════════════════════╣
║  Mode      → ${(DRY_RUN ? "🧪 DRY RUN" : "🚀 LIVE TRADING").padEnd(40)}║
║  Dashboard → http://localhost:${PORT}                     ║
║  WS        → ws://localhost:${PORT}                       ║
║  Source    → ${(DATA_SOURCE === "auto" ? "AUTO (bybit→okx→binance→bingx)" : DATA_SOURCE.toUpperCase()).padEnd(36)}║
║  Symbol    → ${SYMBOL.padEnd(36)}║
║  Timeframe → ${INTERVAL.padEnd(36)}║
║  Poll      → every ${(POLL_MS / 1000).toString().padEnd(26)}s   ║
║                                                        ║
║  Margin    → $${FIXED_MARGIN} | Leverage → ${LEVERAGE}x | Profit Target → ${(TP_MULTIPLIER * 100).toFixed(0)}%║
║  Risk Model→ Fixed $${FIXED_MARGIN} margin per trade            ║
║                                                        ║
║  /signal   → GET   latest signal                       ║
║  /history  → GET   last 50 signals                     ║
║  /health   → GET   server status                       ║
║  /refresh  → POST  force re-analyze now                ║
║  /simulate → POST  mock data (dev)                     ║
╚════════════════════════════════════════════════════════╝
`);
  await tick();
  setInterval(tick, POLL_MS);
});
