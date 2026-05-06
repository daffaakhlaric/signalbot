const WebSocket = require("ws");

let ws = null;
let currentSymbols = [];
let currentInterval = "1m";
let reconnectTimer = null;
let klineCallback = null;
let connectCallback = null;
let disconnectCallback = null;

const ALL_SYMBOLS = ["btcusdt", "ethusdt", "solusdt", "labusdt"];

function startStream(opts) {
  opts = opts || {};
  const symbols = opts.symbols || ALL_SYMBOLS;
  klineCallback = opts.onKline || null;
  connectCallback = opts.onConnect || null;
  disconnectCallback = opts.onDisconnect || null;

  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }

  currentSymbols = symbols;

  const streams = symbols.map(s => `${s.toLowerCase()}@kline_${currentInterval}`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  console.log("🔌 Connecting to Binance streams:", streams);

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("🟢 WS connected to", symbols.length, "streams");
    if (connectCallback) connectCallback();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on("message", (msg) => {
    try {
      const json = JSON.parse(msg);
      const data = json.data || json;
      const k = data.k;
      if (!k) return;

      const symbol = data.stream ? data.stream.split("@")[0].toUpperCase() : (k.s || currentSymbols[0] || "BTCUSDT");

      const candle = {
        time: k.t,
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
        isClosed: k.x,
        symbol: symbol,
        interval: currentInterval
      };

      if (klineCallback) klineCallback(candle);
    } catch (e) {
      console.error("WS parse error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("🔴 WS closed — reconnecting in 3s...");
    if (disconnectCallback) disconnectCallback();
    reconnectTimer = setTimeout(() => {
      startStream({ symbols: currentSymbols, onKline: klineCallback, onConnect: connectCallback, onDisconnect: disconnectCallback });
    }, 3000);
  });

  ws.on("error", (e) => {
    console.error("WS error:", e.message);
  });
}

function stopStream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }
}

function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

module.exports = { startStream, stopStream, isConnected, ALL_SYMBOLS };