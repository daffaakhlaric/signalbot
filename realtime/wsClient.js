const WebSocket = require("ws");

let ws = null;
let currentSymbol = "btcusdt";
let currentInterval = "1m";
let reconnectTimer = null;

function startStream({ symbol = "btcusdt", interval = "1m", onKline, onConnect, onDisconnect }) {
  if (ws) {
    ws.removeAllListeners();
    ws.close();
    ws = null;
  }

  currentSymbol = symbol.toLowerCase();
  currentInterval = interval;

  const stream = `${currentSymbol}@kline_${currentInterval}`;
  const url = `wss://stream.binance.com:9443/ws/${stream}`;

  console.log("🔌 Connecting to Binance stream:", stream);

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("🟢 WS connected:", stream);
    onConnect && onConnect();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on("message", (msg) => {
    try {
      const json = JSON.parse(msg);
      const k = json.k;
      if (!k) return;

      const candle = {
        time: k.t,
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
        isClosed: k.x,
        symbol: currentSymbol.toUpperCase(),
        interval: currentInterval
      };

      onKline && onKline(candle);
    } catch (e) {
      console.error("WS parse error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("🔴 WS closed — reconnecting in 3s...");
    onDisconnect && onDisconnect();
    reconnectTimer = setTimeout(() => {
      startStream({ symbol: currentSymbol, interval: currentInterval, onKline, onConnect, onDisconnect });
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

module.exports = { startStream, stopStream, isConnected };
