# ⚡ BTC SNIPER BOT — BingX Signal System

> BingX perp futures → Backend (indicators + GPT-4o-mini) → Dashboard
> Optimized for BTCUSDT 100x–150x leverage sniper entries

---

## 🗂️ Project Structure

```
signalbot/
├── server.js        ← Backend: BingX poller + indicators + GPT + WS
├── index.html       ← Dashboard (open in browser, no build needed)
├── package.json
├── .env             ← Config (OpenAI key, symbol, interval, poll rate)
└── README.md
```

---

## 🔄 Data Flow

```
BingX REST API  (perp futures klines, public)
   ↓ poll every POLL_INTERVAL_MS
Backend   compute EMA20/50/200, RSI14, structure, S/R
   ↓ on new bar close only
GPT-4o-mini   generate sniper signal JSON
   ↓ WebSocket
Dashboard   live price + signal + history
```

No TradingView. No n8n. Backend talks directly to BingX.

---

## 🚀 Quick Start

```bash
npm install
# edit .env → set OPENAI_API_KEY, pick SYMBOL/INTERVAL
npm start
```

Then open `index.html` in your browser — it auto-connects to `ws://localhost:3001`.

Server logs:
```
📊 New 15m bar — BTCUSDT @ 93750
🤖 Analyzing with GPT-4o-mini...
✅ LONG | bias: bullish | Price holding above EMA20, HH structure confirmed
```

Dots (`.`) between analyses = polling happening, same bar, no GPT call.

---

## ⚙️ Configuration (`.env`)

| Variable            | Default        | Description                                          |
|---------------------|----------------|------------------------------------------------------|
| `OPENAI_API_KEY`    | *(required)*   | Your OpenAI key                                      |
| `PORT`              | `3001`         | HTTP + WS port                                       |
| `SYMBOL`            | `BTC-USDT`     | BingX symbol (dash format)                           |
| `INTERVAL`          | `15m`          | `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M`    |
| `POLL_INTERVAL_MS`  | `30000`        | How often to poll BingX (GPT runs only on new bar)   |
| `BINGX_BASE`        | BingX open-api | Override for proxies                                 |

---

## 📡 API Endpoints

| Method | Path        | Description                                 |
|--------|-------------|---------------------------------------------|
| GET    | `/signal`   | Latest signal + market data                 |
| GET    | `/history`  | Last 50 signals                             |
| GET    | `/health`   | Uptime, symbol, interval, last bar analyzed |
| POST   | `/refresh`  | Force an immediate poll + GPT analysis      |
| POST   | `/simulate` | Send a mock payload (dev mode, no BingX)    |

Example:
```bash
curl http://localhost:3001/health
curl -X POST http://localhost:3001/refresh
```

---

## 📊 Computed Market Payload (per bar)

```json
{
  "pair": "BTCUSDT",
  "timeframe": "15m",
  "open": 93400, "high": 94800, "low": 92900, "close": 93750,
  "volume": 2345.6,
  "ema20": 93500, "ema50": 92400, "ema200": 87500,
  "rsi": 57.2,
  "structure": "HH",
  "support": 93000, "resistance": 94500,
  "barTime": 1745496000000,
  "timestamp": "2026-04-24T10:00:00.000Z"
}
```

Indicators computed from 250 candles fetched from BingX.

---

## 🤖 Signal Output (GPT-4o-mini)

```json
{
  "market_condition": "trend",
  "bias": "bullish",
  "no_trade_zone": ["93200", "93700"],
  "long_safe":   { "entry": "93800", "type": "reclaim breakout",
                   "tp": ["94200","94800"], "sl": "93400" },
  "short_safe":  { "entry": "94500", "type": "rejection",
                   "tp": ["94100","93600"], "sl": "94800" },
  "sniper_long": { "entry_zone": ["93000","93200"],
                   "trigger": "Wick below 93000 + bullish close above 93200",
                   "tp": ["93700","94200"], "sl": "92700" },
  "sniper_short":{ "entry_zone": ["94500","94700"],
                   "trigger": "Sweep above 94500 + immediate rejection",
                   "tp": ["94100","93600"], "sl": "94900" },
  "decision_now": "LONG",
  "reason": "Price holding above EMA20/50, HH structure, RSI trending up from 50"
}
```

---

## 💡 Notes

- **Node ≥ 18** required (uses native `fetch`).
- Every poll broadcasts live `market_data` to the dashboard so price updates even mid-bar.
- GPT-4o-mini is called **once per new bar close**, not every poll — keeps OpenAI costs low.
- BingX public market endpoints require **no API key**. If you later want private data (positions, orders), you'll need to add your BingX API key + HMAC signing.

---

## ⚠️ Risk Disclaimer

This tool is for **informational purposes only**.
Trading at 100x–150x leverage carries **extreme risk of total capital loss**.
Always use proper position sizing and never risk more than you can afford to lose.
