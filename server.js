// ============================================================
// BTC SNIPER BOT — Pure Sniper Engine (No AI)
// Deterministic rule-based trading signals
// Polls exchange klines → computes indicators → sniper engine
// ============================================================

require("dotenv").config();
const dns = require("node:dns");
// Prefer IPv4 to avoid "fetch failed" when IPv6 is not routable (common on Windows / ISP).
dns.setDefaultResultOrder("ipv4first");

// ⚠️  SSL/TLS cert validation workaround (for dev/testing with expired certs)
// ❗ NEVER use in production — this disables critical security
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.log("⚠️  TLS cert validation DISABLED (dev mode)");
}

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

// Multi-pair support (comma-separated, e.g., "BTC-USDT,AXS-USDT,SOL-USDT")
const SYMBOLS = (process.env.SYMBOLS || "BTC-USDT,AXS-USDT").split(",").map(s => s.trim());
const INTERVAL = process.env.INTERVAL || "15m";
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);
const KLINE_LIMIT = 250;                                      // enough for EMA200

// ── Fixed Risk Execution Model ─────────────────────────────
const FIXED_MARGIN = 5;                                       // USD per trade
const LEVERAGE = 150;                                         // x leverage
const TP_MULTIPLIER = 1.0;                                    // 100% profit on margin
const DRY_RUN = (process.env.DRY_RUN || "false").toLowerCase() === "true";

// ── Signal Generation Mode ─────────────────────────────────
const MODE = (process.env.MODE || "BALANCED").toUpperCase();  // AGGRESSIVE | BALANCED | SAFE

// ── Force Entry Mode ───────────────────────────────────────
const FORCE_ENTRY = (process.env.FORCE_ENTRY || "false").toLowerCase() === "true";

const BINGX_BASE   = process.env.BINGX_BASE   || "https://open-api.bingx.com";
const BINGX_API_KEY    = process.env.BINGX_API_KEY    || "";
const BINGX_API_SECRET = process.env.BINGX_API_SECRET || "";
const BINANCE_BASE = process.env.BINANCE_BASE || "https://fapi.binance.com";
const BYBIT_BASE   = process.env.BYBIT_BASE   || "https://api.bybit.com";
const OKX_BASE     = process.env.OKX_BASE     || "https://www.okx.com";

let activeSource = DATA_SOURCE === "auto" ? null : DATA_SOURCE;

// ── Per-Pair State ──────────────────────────────────────────────
const pairState = {};
SYMBOLS.forEach(symbol => {
  pairState[symbol] = {
    signalHistory: [],
    latestSignal: null,
    latestPayload: null,
    lastAnalyzedBarTime: 0,
  };
});

// Legacy state (keep for backward compatibility)
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
  if (highs.length < 10 || lows.length < 10) return "NA";
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

// ── Real-Time Trigger Detection ───────────────────────────────
function getRealtimeTrigger(candle) {
  const range = candle.high - candle.low;
  if (range === 0) return null;

  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;

  const upperPct = upperWick / range;
  const lowerPct = lowerWick / range;

  // 🔴 SHORT TRIGGER: Upper wick > 30% (lowered from 0.4)
  if (upperPct > 0.3) return "SHORT";

  // 🟢 LONG TRIGGER: Lower wick > 30% (lowered from 0.4)
  if (lowerPct > 0.3) return "LONG";

  return null;
}

// ── Candle Trigger Detection ───────────────────────────────────
function getCandleTrigger(candle) {
  return getRealtimeTrigger(candle);
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
      c.lowerWickPct > 0.3 &&
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
      c.upperWickPct > 0.3 &&
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

// ── Check if price is in zone ──────────────────────────────────
function isPriceInZone(price, zone) {
  return price >= zone[0] && price <= zone[1];
}

// ── Sniper Recommendation Engine (with Hybrid Fallback Logic) ────
function getSniperRecommendation(signal, payload) {
  const price = payload.close;
  const { support, resistance, structure, ema20, ema50, ema200 } = payload;

  const range = resistance - support;
  const topZone = resistance - range * 0.15;
  const botZone = support + range * 0.15;

  let preferred = "NONE";
  let reason = "";
  let mode = "trend"; // "trend" or "range"

  // Primary: Determine preferred direction from structure
  if (structure === "LH" || structure === "LL") {
    preferred = "SHORT";
    reason = `bearish structure (${structure})`;
    mode = "trend";
  } else if (structure === "HH" || structure === "HL") {
    preferred = "LONG";
    reason = `bullish structure (${structure})`;
    mode = "trend";
  } else {
    // Fallback 1: Use HTF bias if structure is neutral
    if (signal.htf_bias === "LONG") {
      preferred = "LONG";
      reason = "HTF bias is LONG";
      mode = "trend";
    } else if (signal.htf_bias === "SHORT") {
      preferred = "SHORT";
      reason = "HTF bias is SHORT";
      mode = "trend";
    } else {
      // Fallback 2: Use EMA alignment if HTF bias is neutral
      if (ema20 && ema50 && ema200) {
        if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
          preferred = "LONG";
          reason = "EMA uptrend alignment (20>50>200)";
          mode = "trend";
        } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
          preferred = "SHORT";
          reason = "EMA downtrend alignment (20<50<200)";
          mode = "trend";
        } else {
          // Fallback 3: SCALP mode for sideways/neutral markets
          preferred = "SCALP";
          reason = "sideways market - SCALP mode active";
          mode = "range";
        }
      } else {
        // Fallback 3: SCALP mode if EMAs not available
        preferred = "SCALP";
        reason = "neutral market - SCALP mode active";
        mode = "range";
      }
    }
  }

  // Determine status based on price position and mode
  let status = "WAIT";

  if (mode === "trend") {
    if (preferred === "SHORT") {
      if (isPriceInZone(price, signal.sniper_short.entry_zone)) {
        status = "ACTIVE_SHORT";
      } else if (price >= topZone) {
        status = "READY_SHORT";
      }
    } else if (preferred === "LONG") {
      if (isPriceInZone(price, signal.sniper_long.entry_zone)) {
        status = "ACTIVE_LONG";
      } else if (price <= botZone) {
        status = "READY_LONG";
      }
    }
  } else if (mode === "range") {
    // SCALP mode: look for zone entries from both directions
    if (isPriceInZone(price, signal.sniper_short.entry_zone)) {
      status = "ACTIVE_SHORT_SCALP";
    } else if (isPriceInZone(price, signal.sniper_long.entry_zone)) {
      status = "ACTIVE_LONG_SCALP";
    } else if (price >= topZone) {
      status = "READY_SHORT_SCALP";
    } else if (price <= botZone) {
      status = "READY_LONG_SCALP";
    }
  }

  return {
    preferred,
    status,
    reason,
    mode,
    trigger_price: {
      short: signal.sniper_short.entry_zone[0],
      long: signal.sniper_long.entry_zone[1]
    },
    entry_zone: {
      short: signal.sniper_short.entry_zone,
      long: signal.sniper_long.entry_zone
    }
  };
}

// ── Scalper Recommendation (Fast, Small TP) ───────────────────
function getScalperRecommendation(payload) {
  const price = payload.close;
  const { support, resistance, ema20, rsi } = payload;

  const range = resistance - support;
  const tpRange = range * 0.12;    // fast TP (12% of range)
  const slRange = range * 0.08;    // tight SL (8% of range)

  let direction = "NONE";
  let entry = null;
  let tp = null;
  let sl = null;
  let reason = "";

  // 🟢 LONG: price near/below EMA, RSI oversold
  if (price <= ema20 && rsi < 55) {
    direction = "LONG";
    entry = price;
    tp = price + tpRange;
    sl = price - slRange;
    reason = "scalp EMA bounce (oversold)";
  }
  // 🔴 SHORT: price near/above EMA, RSI overbought
  else if (price >= ema20 && rsi > 45) {
    direction = "SHORT";
    entry = price;
    tp = price - tpRange;
    sl = price + slRange;
    reason = "scalp EMA rejection (overbought)";
  }
  // ⚡ FALLBACK: always return LONG or SHORT (never NONE)
  else if (price < ema20) {
    direction = "LONG";
    entry = price;
    tp = price + tpRange * 0.7;  // reduced TP
    sl = price - slRange;
    reason = "fallback EMA support";
  } else {
    direction = "SHORT";
    entry = price;
    tp = price - tpRange * 0.7;  // reduced TP
    sl = price + slRange;
    reason = "fallback EMA resistance";
  }

  return {
    direction,
    entry: round(entry, 2),
    tp: round(tp, 2),
    sl: round(sl, 2),
    mode: "scalp",
    reason
  };
}

// ══════════════════════════════════════════════════════════════
// MULTI-STRATEGY SIGNAL ENGINE
// ══════════════════════════════════════════════════════════════

// ── Session Detector ─────────────────────────────────────────
function getSession() {
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 7  && utcHour < 12)  return { name: "London Open",   active: true,  quality: "high" };
  if (utcHour >= 12 && utcHour < 16)  return { name: "NY Open",       active: true,  quality: "high" };
  if (utcHour >= 16 && utcHour < 20)  return { name: "London/NY Overlap", active: true, quality: "high" };
  if (utcHour >= 20 && utcHour < 23)  return { name: "NY Session",    active: true,  quality: "medium" };
  if (utcHour >= 0  && utcHour < 7)   return { name: "Asian Session", active: false, quality: "low" };
  return { name: "Off-Session", active: false, quality: "low" };
}

// ── Trend Rider Signal ────────────────────────────────────────
function getTrendRiderSignal(payload, htfBias) {
  const { close: price, ema20, ema50, ema200, structure, support, resistance, rsi: rsiVal } = payload;
  const range = resistance - support;

  const emaUptrend   = ema20 > ema50 && ema50 > ema200 && price > ema20;
  const emaDowntrend = ema20 < ema50 && ema50 < ema200 && price < ema20;

  const bullStructure = structure === "HH" || structure === "HL";
  const bearStructure = structure === "LL" || structure === "LH";

  let direction = "WAIT";
  let reason    = "";
  let entry = null, tp = null, sl = null, strength = "weak";

  if (emaUptrend && bullStructure && (htfBias === "LONG" || htfBias === "NEUTRAL")) {
    // Pullback entry near EMA20
    if (price <= ema20 * 1.005 && price >= ema20 * 0.995) {
      direction = "LONG";
      entry = price;
      tp    = price + range * 0.6;
      sl    = ema50 * 0.998;
      reason = `EMA uptrend (20>50>200) + ${structure} structure — pullback to EMA20`;
      strength = rsiVal < 60 ? "strong" : "moderate";
    } else {
      direction = "LONG";
      entry = ema20;
      tp    = ema20 + range * 0.6;
      sl    = ema50 * 0.998;
      reason = `EMA uptrend + ${structure} — wait pullback to EMA20`;
      strength = "waiting";
    }
  } else if (emaDowntrend && bearStructure && (htfBias === "SHORT" || htfBias === "NEUTRAL")) {
    if (price >= ema20 * 0.995 && price <= ema20 * 1.005) {
      direction = "SHORT";
      entry = price;
      tp    = price - range * 0.6;
      sl    = ema50 * 1.002;
      reason = `EMA downtrend (20<50<200) + ${structure} structure — rejection at EMA20`;
      strength = rsiVal > 40 ? "strong" : "moderate";
    } else {
      direction = "SHORT";
      entry = ema20;
      tp    = ema20 - range * 0.6;
      sl    = ema50 * 1.002;
      reason = `EMA downtrend + ${structure} — wait rejection at EMA20`;
      strength = "waiting";
    }
  } else {
    reason = "no EMA alignment for trend";
  }

  const rr = (entry && tp && sl)
    ? Math.abs(tp - entry) / Math.abs(entry - sl)
    : 0;

  return {
    direction,
    entry: round(entry, 2),
    tp:    round(tp, 2),
    sl:    round(sl, 2),
    rr:    round(rr, 2),
    trend_strength: strength,
    reason,
  };
}

// ── Momentum Break Signal ──────────────────────────────────────
function getMomentumBreakSignal(payload) {
  const { lastCandle, prevCandle, support, resistance, rsi: rsiVal } = payload;
  const range = resistance - support;

  const body     = Math.abs(lastCandle.close - lastCandle.open);
  const fullRange = lastCandle.high - lastCandle.low;
  const bodyPct  = fullRange > 0 ? body / fullRange : 0;
  const upperWick = lastCandle.high - Math.max(lastCandle.close, lastCandle.open);
  const lowerWick = Math.min(lastCandle.close, lastCandle.open) - lastCandle.low;

  const breakResist = lastCandle.close > resistance && prevCandle.close <= resistance;
  const breakSupport = lastCandle.close < support    && prevCandle.close >= support;

  const strongBody = bodyPct > 0.65;
  const lowWick    = (breakResist ? upperWick : lowerWick) / fullRange < 0.2;

  let direction = "WAIT", entry = null, tp = null, sl = null, strength = "none";
  let entry_type = "none", reason = "";

  if (breakResist && strongBody) {
    direction  = "LONG";
    entry      = resistance * 1.001;
    tp         = resistance + range * 0.7;
    sl         = resistance * 0.997;
    entry_type = "instant";
    strength   = strongBody && lowWick ? "strong" : "moderate";
    reason     = `resistance breakout at ${round(resistance, 2)} — strong body ${(bodyPct * 100).toFixed(0)}%`;
  } else if (breakSupport && strongBody) {
    direction  = "SHORT";
    entry      = support * 0.999;
    tp         = support - range * 0.7;
    sl         = support * 1.003;
    entry_type = "instant";
    strength   = strongBody && lowWick ? "strong" : "moderate";
    reason     = `support breakdown at ${round(support, 2)} — strong body ${(bodyPct * 100).toFixed(0)}%`;
  } else if (rsiVal > 70) {
    direction = "SHORT"; entry = null;
    reason = `RSI overbought (${rsiVal}) — potential breakdown`;
    entry_type = "watching";
  } else if (rsiVal < 30) {
    direction = "LONG"; entry = null;
    reason = `RSI oversold (${rsiVal}) — potential breakout`;
    entry_type = "watching";
  } else {
    reason = "no valid breakout detected";
  }

  const rr = (entry && tp && sl) ? Math.abs(tp - entry) / Math.abs(entry - sl) : 0;

  return {
    direction,
    breakout_level: breakResist ? round(resistance, 2) : breakSupport ? round(support, 2) : null,
    entry_type,
    entry: round(entry, 2),
    tp:    round(tp, 2),
    sl:    round(sl, 2),
    rr:    round(rr, 2),
    strength,
    reason,
  };
}

// ── Liquidity Sweep Signal ─────────────────────────────────────
function getLiquiditySweepSignal(payload) {
  const { lastCandle, support, resistance, close: price } = payload;
  const range = resistance - support;

  const fullRange  = lastCandle.high - lastCandle.low;
  if (fullRange === 0) return { direction: "WAIT", reason: "no range" };

  const upperWick = lastCandle.high - Math.max(lastCandle.close, lastCandle.open);
  const lowerWick = Math.min(lastCandle.close, lastCandle.open) - lastCandle.low;
  const upperWickPct = upperWick / fullRange;
  const lowerWickPct = lowerWick / fullRange;

  // Liquidity sweep: spike above resistance then close back below
  const upperSweep = lastCandle.high > resistance && lastCandle.close < resistance && upperWickPct > 0.4;
  // Liquidity sweep: spike below support then close back above
  const lowerSweep = lastCandle.low < support && lastCandle.close > support && lowerWickPct > 0.4;

  let direction = "WAIT", entry = null, tp = null, sl = null, reason = "", liquidity_zone = null;

  if (upperSweep) {
    direction      = "SHORT";
    liquidity_zone = round(resistance, 2);
    entry          = price;
    tp             = price - range * 0.55;
    sl             = lastCandle.high * 1.001;
    reason = `liquidity grab above resistance (${round(resistance, 2)}) — upper wick ${(upperWickPct * 100).toFixed(0)}% — reversal short`;
  } else if (lowerSweep) {
    direction      = "LONG";
    liquidity_zone = round(support, 2);
    entry          = price;
    tp             = price + range * 0.55;
    sl             = lastCandle.low * 0.999;
    reason = `liquidity grab below support (${round(support, 2)}) — lower wick ${(lowerWickPct * 100).toFixed(0)}% — reversal long`;
  } else {
    reason = "no liquidity sweep detected";
  }

  const rr = (entry && tp && sl) ? Math.abs(tp - entry) / Math.abs(entry - sl) : 0;

  return {
    direction,
    liquidity_zone,
    entry: round(entry, 2),
    tp:    round(tp, 2),
    sl:    round(sl, 2),
    rr:    round(rr, 2),
    reason,
  };
}

// ── Structure Flip Signal ──────────────────────────────────────
function getStructureFlipSignal(payload, prevStructure) {
  const { structure, close: price, support, resistance, lastCandle, prevCandle } = payload;
  const range = resistance - support;

  // Structure flip detection
  const bullFlip = (prevStructure === "LL" || prevStructure === "LH") &&
                   (structure === "HL" || structure === "HH");
  const bearFlip = (prevStructure === "HH" || prevStructure === "HL") &&
                   (structure === "LH" || structure === "LL");

  const body = Math.abs(lastCandle.close - lastCandle.open);
  const fullRange = lastCandle.high - lastCandle.low;
  const bodyPct = fullRange > 0 ? body / fullRange : 0;
  const isEngulfing = bodyPct > 0.6 &&
    ((lastCandle.close > lastCandle.open && lastCandle.close > prevCandle.open && lastCandle.open < prevCandle.close) ||
     (lastCandle.close < lastCandle.open && lastCandle.close < prevCandle.open && lastCandle.open > prevCandle.close));

  let direction = "WAIT", entry = null, tp = null, sl = null;
  let reversal_type = "none", confidence = "low", reason = "";

  if (bullFlip) {
    direction    = "LONG";
    reversal_type = `${prevStructure} → ${structure}`;
    entry        = price;
    tp           = price + range * 0.65;
    sl           = support * 0.997;
    confidence   = isEngulfing ? "high" : "medium";
    reason = `structure flip ${reversal_type}${isEngulfing ? " + engulfing confirmation" : ""}`;
  } else if (bearFlip) {
    direction    = "SHORT";
    reversal_type = `${prevStructure} → ${structure}`;
    entry        = price;
    tp           = price - range * 0.65;
    sl           = resistance * 1.003;
    confidence   = isEngulfing ? "high" : "medium";
    reason = `structure flip ${reversal_type}${isEngulfing ? " + engulfing confirmation" : ""}`;
  } else {
    reason = `no structure flip (current: ${structure}, prior: ${prevStructure || "N/A"})`;
  }

  const rr = (entry && tp && sl) ? Math.abs(tp - entry) / Math.abs(entry - sl) : 0;

  return {
    direction,
    reversal_type,
    entry: round(entry, 2),
    tp:    round(tp, 2),
    sl:    round(sl, 2),
    rr:    round(rr, 2),
    confidence,
    reason,
  };
}

// ── Signal Score (0–5 confluence) ─────────────────────────────
function computeSignalScore(direction, payload, htfBias, momFilter) {
  if (direction === "WAIT" || direction === "SKIP" || !direction) return 0;
  let score = 0;
  const { ema20, ema50, ema200, rsi: rsiVal, structure, close: price } = payload;

  // 1. HTF bias alignment
  if (htfBias === direction) score++;

  // 2. Full EMA alignment
  const emaUp   = ema20 > ema50 && ema50 > ema200;
  const emaDown = ema20 < ema50 && ema50 < ema200;
  if ((direction === "LONG" && emaUp) || (direction === "SHORT" && emaDown)) score++;

  // 3. Strong momentum
  const range = payload.resistance - payload.support;
  const dynMom = (range / price) * 0.2;
  if (momFilter > dynMom) score++;

  // 4. RSI confluence
  if (direction === "LONG"  && rsiVal < 60 && rsiVal > 25) score++;
  if (direction === "SHORT" && rsiVal > 40 && rsiVal < 75) score++;

  // 5. Structure alignment
  const bullStruct = structure === "HH" || structure === "HL";
  const bearStruct = structure === "LL" || structure === "LH";
  if ((direction === "LONG" && bullStruct) || (direction === "SHORT" && bearStruct)) score++;

  return score;
}

// ── Elite Setup (High Confluence Filter) ──────────────────────
function getEliteSetupSignal(signals, payload, htfBias, momFilter) {
  const candidates = [];

  const check = (name, sig) => {
    if (!sig || sig.direction === "WAIT" || sig.direction === "SKIP") return;
    const score = computeSignalScore(sig.direction, payload, htfBias, momFilter);
    if (score >= 3 && sig.rr >= 1.8) {
      candidates.push({ name, score, ...sig });
    }
  };

  check("Precision Entry",  signals.precision_entry);
  check("Quick Strike",     signals.quick_strike);
  check("Trend Rider",      signals.trend_rider);
  check("Momentum Break",   signals.momentum_break);
  check("Liquidity Sweep",  signals.liquidity_sweep);
  check("Structure Flip",   signals.structure_flip);

  if (candidates.length === 0) {
    return {
      active: false,
      direction: "WAIT",
      signal_type: "none",
      entry: null, tp: null, sl: null, rr: null,
      score: 0,
      reason: "no elite setup — confluence below threshold",
    };
  }

  // Pick best (highest score, then highest RR)
  candidates.sort((a, b) => b.score - a.score || b.rr - a.rr);
  const best = candidates[0];

  return {
    active: true,
    direction: best.direction,
    signal_type: best.name,
    entry: best.entry,
    tp:    best.tp,
    sl:    best.sl,
    rr:    round(best.rr, 2),
    score: best.score,
    reason: `Elite setup from ${best.name} — score ${best.score}/5 | ${best.reason}`,
  };
}

// ── Adaptive Thresholds Per Signal Type ───────────────────────
const SIGNAL_THRESHOLDS = {
  precision_entry: { rr: 1.5, score: 2 },
  momentum_break:   { rr: 1.5, score: 2 },
  liquidity_sweep:  { rr: 1.5, score: 2 },
  trend_rider:      { rr: 1.5, score: 2 },
  quick_strike:     { rr: 1.3, score: 1 },
};

const PRIORITY = {
  precision_entry:  1,
  momentum_break:   2,
  liquidity_sweep:  2,
  trend_rider:      3,
  quick_strike:     4,
};

// ── Select Single Best Signal (adaptive, fallback-enabled) ─────
function selectBestSignal(signals, elite_setup) {
  const candidates = [];

  // Elite setup — highest tier
  if (elite_setup?.active && (elite_setup.rr || 0) >= 1.8 && (elite_setup.score || 0) >= 3) {
    candidates.push({
      type:      elite_setup.signal_type || "Elite Setup",
      direction: elite_setup.direction,
      entry:     elite_setup.entry,
      tp:        elite_setup.tp,
      sl:        elite_setup.sl,
      rr:        elite_setup.rr,
      score:     elite_setup.score,
      reason:    elite_setup.reason,
      _priority: 0,
    });
  }

  // Adaptive filter per signal type
  Object.entries(signals).forEach(([key, sig]) => {
    if (!sig) return;
    if (!sig.direction || sig.direction === "WAIT" || sig.direction === "SKIP") return;

    const thresh = SIGNAL_THRESHOLDS[key] || { rr: 1.5, score: 2 };
    if ((sig.rr   || 0) < thresh.rr)   return;
    if ((sig.score || 0) < thresh.score) return;

    candidates.push({
      type:      key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      direction: sig.direction,
      entry:     sig.entry,
      tp:        sig.tp,
      sl:        sig.sl,
      rr:        sig.rr,
      score:     sig.score,
      reason:    sig.reason,
      _priority: PRIORITY[key] ?? 5,
    });
  });

  // Fallback: best available without strict filters
  if (candidates.length === 0) {
    const fallback = Object.entries(signals)
      .filter(([_, s]) => s && s.direction && s.direction !== "WAIT" && s.direction !== "SKIP")
      .sort((a, b) => (b[1].rr || 0) - (a[1].rr || 0))[0];

    if (fallback) {
      const [key, sig] = fallback;
      return {
        type:       key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        direction:  sig.direction,
        entry:      sig.entry,
        tp:         sig.tp,
        sl:         sig.sl,
        rr:         round(sig.rr || 0, 2),
        score:      sig.score || 1,
        confidence: "low",
        reason:     "fallback signal (low confluence)",
      };
    }

    return {
      type:       "NONE",
      direction:  "WAIT",
      entry:      null,
      tp:         null,
      sl:         null,
      rr:         null,
      score:      0,
      confidence: "low",
      reason:     "no valid setup — all signals below threshold",
    };
  }

  // Sort: highest score → highest RR → lowest priority
  candidates.sort((a, b) =>
    (b.score - a.score) ||
    ((b.rr || 0) - (a.rr || 0)) ||
    (a._priority - b._priority)
  );

  const best = candidates[0];
  const confidence = best.score >= 4 ? "high" : best.score >= 2 ? "medium" : "low";

  return {
    type:       best.type,
    direction:  best.direction,
    entry:      best.entry,
    tp:         best.tp,
    sl:         best.sl,
    rr:         round(best.rr, 2),
    score:      best.score,
    confidence,
    reason:     best.reason,
  };
}

// ── Build Full Multi-Strategy Signals ─────────────────────────
function buildMultiSignals(payload, htfBias, sniperSignal, prevStructure) {
  const momFilter = Math.abs(payload.close - payload.prevCandle.close) / payload.close;

  // Renamed signals (premium branding)
  const precision_entry = {
    direction: sniperSignal.decision_now === "SKIP" ? "WAIT" : sniperSignal.decision_now,
    entry: sniperSignal.decision_now === "LONG"
      ? sniperSignal.sniper_long?.entry_zone?.[0]
      : sniperSignal.sniper_short?.entry_zone?.[0],
    tp: sniperSignal.decision_now === "LONG"
      ? sniperSignal.sniper_long?.tp?.[0]
      : sniperSignal.sniper_short?.tp?.[0],
    sl: sniperSignal.decision_now === "LONG"
      ? sniperSignal.sniper_long?.sl
      : sniperSignal.sniper_short?.sl,
    rr: null,
    confidence: sniperSignal.confidence,
    reason: sniperSignal.reason,
    status: sniperSignal.decision_now === "SKIP" ? "WAIT" : "ACTIVE",
  };
  if (precision_entry.entry && precision_entry.tp && precision_entry.sl) {
    precision_entry.rr = round(
      Math.abs(precision_entry.tp - precision_entry.entry) /
      Math.abs(precision_entry.entry - precision_entry.sl), 2
    );
  }

  const scalperRaw   = getScalperRecommendation(payload);
  const quick_strike = {
    direction: scalperRaw.direction,
    entry: scalperRaw.entry,
    tp:    scalperRaw.tp,
    sl:    scalperRaw.sl,
    rr: scalperRaw.entry && scalperRaw.tp && scalperRaw.sl
      ? round(Math.abs(scalperRaw.tp - scalperRaw.entry) / Math.abs(scalperRaw.entry - scalperRaw.sl), 2)
      : null,
    reason: scalperRaw.reason,
    status: scalperRaw.direction !== "NONE" ? "ACTIVE" : "WAIT",
  };

  const trend_rider    = getTrendRiderSignal(payload, htfBias);
  const momentum_break = getMomentumBreakSignal(payload);
  const liquidity_sweep = getLiquiditySweepSignal(payload);
  const structure_flip  = getStructureFlipSignal(payload, prevStructure);

  const signals = {
    precision_entry,
    quick_strike,
    trend_rider,
    momentum_break,
    liquidity_sweep,
    structure_flip,
  };

  // Score each signal
  Object.keys(signals).forEach(key => {
    const sig = signals[key];
    if (sig && sig.direction && sig.direction !== "WAIT") {
      sig.score = computeSignalScore(sig.direction, payload, htfBias, momFilter);
    } else {
      sig.score = 0;
    }
  });

  const elite_setup  = getEliteSetupSignal(signals, payload, htfBias, momFilter);
  const session      = getSession();
  const best_signal  = selectBestSignal(signals, elite_setup);

  return {
    pair:        payload.pair,
    timestamp:   new Date().toISOString(),
    best_signal,
    signals,
    elite_setup,
    session,
    market_context: {
      price:     payload.close,
      structure: payload.structure,
      htf_bias:  htfBias,
      ema20:     payload.ema20,
      ema50:     payload.ema50,
      ema200:    payload.ema200,
      rsi:       payload.rsi,
      support:   payload.support,
      resistance: payload.resistance,
    },
  };
}

// ── Priority Recommendation (Sniper vs Scalper) ────────────────
function getPriorityRecommendation(signal) {
  const sniper = signal.recommendation;
  const scalper = signal.scalper;

  let type = "NONE";
  let action = "WAIT";
  let entry = null;
  let tp = null;
  let sl = null;
  let reason = "";

  // 🔥 1. SNIPER only if LONG/SHORT + ACTIVE/READY (NOT SCALP mode)
  if (
    sniper &&
    (sniper.preferred === "LONG" || sniper.preferred === "SHORT") &&
    (sniper.status.includes("ACTIVE") || sniper.status.includes("READY"))
  ) {
    type = "SNIPER";
    action = sniper.preferred;
    const zone = signal[`sniper_${action.toLowerCase()}`];
    entry = zone?.entry_zone?.[0];
    tp = zone?.tp?.[0];
    sl = zone?.sl;
    reason = "sniper zone active (high probability)";
  }
  // ⚡ 2. SCALPER (always has direction now, never NONE)
  else if (scalper && scalper.direction && scalper.direction !== "NONE") {
    type = "SCALPER";
    action = scalper.direction;
    entry = scalper.entry;
    tp = scalper.tp;
    sl = scalper.sl;
    reason = "scalper quick opportunity";
  }
  // ❌ 3. NO TRADE
  else {
    type = "NONE";
    action = "WAIT";
    reason = "no valid setup";
  }

  return { type, action, entry, tp, sl, reason };
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

// ── Get filter thresholds based on mode ─────────────────────
function getFilterThresholds() {
  switch (MODE) {
    case "AGGRESSIVE":
      return {
        midRangeWidth: 0.15,    // 30% total (wider trade zone)
        wickThreshold: 0.25,    // more lenient
        minRR: 1.3,             // lower RR requirement
        minMomentum: 0.001      // less strict momentum
      };
    case "SAFE":
      return {
        midRangeWidth: 0.3,     // 40% no-trade zone (narrower trade zone)
        wickThreshold: 0.4,     // stricter wicks
        minRR: 2.0,             // higher RR requirement
        minMomentum: 0.005      // stricter momentum
      };
    case "BALANCED":
    default:
      return {
        midRangeWidth: 0.2,     // 40% total (20% on each side)
        wickThreshold: 0.3,     // balanced
        minRR: 1.5,             // standard RR
        minMomentum: 0.002      // standard momentum
      };
  }
}

// ── Core Sniper Signal Generator ──────────────────────────────
function generateSniperSignal(payload) {
  const thresholds = getFilterThresholds();
  const now = new Date();
  const utcHour = now.getUTCHours();

  const price     = payload.close;
  const support   = payload.support;
  const resist   = payload.resistance;
  const range    = resist - support;
  const topZone  = resist - range * 0.15;
  const botZone  = support + range * 0.15;

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

  // 1. Session warning (mark low confidence, don't skip)
  const sessionWarning = !isTradingSession(utcHour);

  // 2. Mid-range filter (adjust width based on MODE)
  const midLowAdj = support + range * thresholds.midRangeWidth;
  const midHighAdj = resist - range * thresholds.midRangeWidth;
  if (price > midLowAdj && price < midHighAdj) {
    const s = defaultSignal();
    s.reason = "price in mid-range no trade zone";
    return s;
  }

  // 3. Min range filter (avoid noise scalping) — lowered from 0.003 to 0.002
  if (range / price < 0.002) {
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
    confidence: sessionWarning ? "low" : (decision !== "SKIP" ? "high" : "low"),
    reason: sessionWarning ? `outside trading session | ${reason}` : reason
  };

  return signal;
}

// ── Validate Signal (RR, entry, direction) ─────────────────────
function validateSignal(signal) {
  if (signal.decision_now === "SKIP") return signal;

  const thresholds = getFilterThresholds();
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

  if (rr < thresholds.minRR) {
    signal.decision_now = "SKIP";
    signal.reason += ` | RR too low ${rr.toFixed(2)} (min: ${thresholds.minRR})`;
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
    pair:       SYMBOLS[0].replace("-", ""),
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

// ── Build market payload for a specific symbol ──────────────
function buildMarketPayloadForSymbol(candles, symbol) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const closes = candles.map((c) => c.close);
  const highs  = candles.map((c) => c.high);
  const lows   = candles.map((c) => c.low);

  const last20 = candles.slice(-20);
  const support    = Math.min(...last20.map((c) => c.low));
  const resistance = Math.max(...last20.map((c) => c.high));

  return {
    pair:       symbol.replace("-", ""),
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

// ── Process a single trading pair ───────────────────────────
async function processPair(symbol) {
  try {
    const state = pairState[symbol];
    if (!state) return;

    const [candles15m, candles1h] = await Promise.all([
      fetchKlines(symbol, "15m", KLINE_LIMIT),
      fetchKlines(symbol, "1h",  KLINE_LIMIT),
    ]);

    if (candles15m.length < 20) return;

    const payload15m = buildMarketPayloadForSymbol(candles15m, symbol);
    const payload1h  = buildMarketPayloadForSymbol(candles1h, symbol);
    state.latestPayload = payload15m;

    // Real-time analysis
    if (payload15m.barTime !== state.lastAnalyzedBarTime) {
      state.lastAnalyzedBarTime = payload15m.barTime;
      botLog("info", `📊 ${symbol} new bar — @ ${payload15m.close} | Structure: ${payload15m.structure}`);
    }

    let signal = generateSniperSignal(payload15m);
    signal = confirmEntry(signal, payload15m);
    signal = validateSignal(signal);
    signal = checkCooldown(signal);

    const htfBias = getHTFBias(payload1h);
    signal.htf_bias = htfBias;
    signal.htf_structure = payload1h.structure;

    const momFilter = Math.abs(payload15m.close - payload15m.prevCandle.close) / payload15m.close;
    const range = payload15m.resistance - payload15m.support;
    const dynamicMomentum = (range / payload15m.close) * 0.2;

    const isAutoTrigger = signal.reason.includes("real-time trigger");
    if (
      !isAutoTrigger &&
      (
        (signal.decision_now === "LONG" && htfBias === "SHORT") ||
        (signal.decision_now === "SHORT" && htfBias === "LONG")
      )
    ) {
      signal.decision_now = "SKIP";
      signal.reason = `HTF mismatch (${htfBias})`;
    }

    if (signal.decision_now !== "SKIP") {
      if (momFilter < dynamicMomentum) {
        signal.confidence = "low";
        signal.reason += " | weak momentum";
      }
    }

    if (signal.decision_now !== "SKIP" && !checkDailyLimit()) {
      signal.decision_now = "SKIP";
      signal.reason = "daily limit reached";
    }

    signal.timestamp = new Date().toISOString();
    signal.price = payload15m.close;
    signal.pair = payload15m.pair;
    signal.source = activeSource || DATA_SOURCE;

    // Get sniper recommendation
    const recommendation = getSniperRecommendation(signal, payload15m);
    signal.recommendation = recommendation;

    // Get scalper recommendation
    const scalper = getScalperRecommendation(payload15m);
    signal.scalper = scalper;

    // Get priority recommendation
    const priority = getPriorityRecommendation(signal);
    signal.priority = priority;

    // Build multi-strategy signals
    const prevStructure = state.latestSignal?.market_context?.structure || payload15m.structure;
    const multiSignals  = buildMultiSignals(payload15m, htfBias, signal, prevStructure);
    signal.multi        = multiSignals;

    // Signal scoring (legacy + new)
    signal.score = multiSignals.best_signal.score || 0;
    if (signal.score < 1 && signal.decision_now !== "SKIP") {
      signal.confidence = "low";
      signal.reason += " | low score";
    }

    // Signal change detection
    if (state.latestSignal && state.latestSignal.decision_now === signal.decision_now && state.latestSignal.price === signal.price) {
      signal.is_same_signal = true;
    } else {
      signal.is_same_signal = false;
    }

    signal.updated_at = new Date().toISOString();
    signal.bar_time = payload15m.barTime;

    state.latestSignal = signal;
    state.signalHistory.unshift(signal);
    if (state.signalHistory.length > 50) state.signalHistory.pop();

    // Also update global state for first pair (BTC-USDT) for backward compatibility
    if (symbol === SYMBOLS[0]) {
      latestSignal = signal;
      latestPayload = { ...payload15m, receivedAt: new Date().toISOString() };
      signalHistory.unshift(signal);
      if (signalHistory.length > 50) signalHistory.pop();
    }

    // Broadcast multi-pair signal
    broadcast({
      type: "multi_signal",
      data: {
        pair:   signal.pair,
        symbol: symbol,
        signal,
        market: payload15m,
        multi:  multiSignals,
      }
    });

    simulateDryTrade(signal, payload15m);
    checkDryTrades(payload15m.close);
  } catch (err) {
    botLog("err", `❌ ${symbol} error: ${err.message}`);
  }
}

// ── Main tick: poll exchange, run sniper engine for all pairs ─
async function tick() {
  try {
    // Process all trading pairs in parallel
    await Promise.all(SYMBOLS.map(symbol => processPair(symbol)));

    // Try to fetch positions (for first pair or all)
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
    console.error(`\n❌ TICK ERROR - Full details:`);
    console.error(err);
    botLog("err", `Fetch failed: ${err.message}`);
  }
}

// ── POST /simulate — instant market data update for testing ────────────────
app.post("/simulate", async (req, res) => {
  try {
    const price = Number(req.body?.price) || latestPayload?.close || 77500;
    const direction = req.body?.direction || "neutral";

    // Create realistic support/resistance from last 20 candles mock
    const support = price * 0.99;
    const resist = price * 1.01;
    const range = resist - support;
    const botZone = support + range * 0.15;
    const topZone = resist - range * 0.15;

    let last, structure;
    if (direction === "long") {
      // Lower wick trigger at support
      last = {
        open: botZone,
        high: price,
        low: support,
        close: botZone + range * 0.1
      };
      structure = "HH"; // bullish
    } else if (direction === "short") {
      // Upper wick trigger at resistance
      last = {
        open: topZone,
        high: resist,
        low: price,
        close: topZone - range * 0.1
      };
      structure = "LL"; // bearish
    } else {
      // Neutral candle in mid-range
      last = {
        open: price,
        high: price * 1.002,
        low: price * 0.998,
        close: price
      };
      structure = "NA";
    }

    const prev = {
      open: price * 0.999,
      high: price * 1.005,
      low: price * 0.995,
      close: price * 0.998
    };

    const payload = {
      pair: SYMBOL.replace("-", ""),
      timeframe: INTERVAL,
      open: last.open,
      high: last.high,
      low: last.low,
      close: price,
      volume: 100,
      ema20: price,
      ema50: price,
      ema200: price,
      rsi: 50,
      structure,
      support: round(support),
      resistance: round(resist),
      barTime: Date.now(),
      timestamp: new Date().toISOString(),
      lastCandle: last,
      prevCandle: prev,
    };

    // Generate signal (will auto-skip if conditions not met, but zones will show)
    let signal = generateSniperSignal(payload);
    signal.timestamp = new Date().toISOString();
    signal.pair = payload.pair;
    signal.source = "simulate";
    signal.htf_bias = direction === "long" ? "LONG" : direction === "short" ? "SHORT" : "NEUTRAL";
    signal.htf_structure = structure;
    signal.updated_at = new Date().toISOString();
    signal.bar_time = payload.barTime;

    // Get recommendation
    const recommendation = getSniperRecommendation(signal, payload);
    signal.recommendation = recommendation;

    // Get scalper recommendation
    const scalper = getScalperRecommendation(payload);
    signal.scalper = scalper;

    // Get priority recommendation
    const priority = getPriorityRecommendation(signal);
    signal.priority = priority;

    // Signal tracking
    if (!latestSignal || latestSignal.price !== signal.price) {
      signal.is_same_signal = false;
    }

    latestSignal = signal;
    latestPayload = payload;
    signalHistory.unshift(signal);
    if (signalHistory.length > 50) signalHistory.pop();

    broadcast({ type: "market_data", data: payload });
    broadcast({ type: "signal", data: signal });
    broadcast({ type: "history", data: signalHistory });
    res.json({ success: true, signal, market_data: payload });
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
║  Symbols   → ${SYMBOLS.join(",").padEnd(36)}║
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
  // Don't await — start polling in background so server can listen immediately
  tick().catch(e => console.error("Initial tick error:", e));
  setInterval(tick, POLL_MS);
});
