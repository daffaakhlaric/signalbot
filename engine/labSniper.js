const LAB_CONFIG = {
  symbol: "LAB-USDT",
  leverage: 20,
  risk_per_trade: 0.05,
  tf_entry: "5m",
  tf_trend: "15m",
  atr_sl: 0.8,
  atr_tp: 1.5,
  min_rr: 1.3,
  trailing_trigger: 0.7,
  trailing_distance: 0.35,
  volume_multiplier: 1.2,
  scalp_tp: 0.7,
  scalp_sl: 0.45,
  mode: "SNIPER",
  min_score: 4
};

function getTrendBias(candles) {
  if (!candles || candles.length < 32) return "NEUTRAL";
  const ema5 = calcEMA(candles.map(c => c.close), 5);
  const ema10 = calcEMA(candles.map(c => c.close), 10);
  const ema30 = calcEMA(candles.map(c => c.close), 30);
  if (ema5 > ema10 && ema10 > ema30) return "LONG";
  if (ema5 < ema10 && ema10 < ema30) return "SHORT";
  return "NEUTRAL";
}

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function getATR(data, len) {
  len = len || 14;
  if (!data || data.length < len + 1) return null;
  var trs = [];
  for (var i = 1; i < data.length; i++) {
    var high = data[i].high;
    var low = data[i].low;
    var prevClose = data[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  var atr = trs.slice(-len).reduce(function(a, b) { return a + b; }, 0) / len;
  return atr;
}

function isStrongBull(c) {
  if (!c) return false;
  var body = Math.abs(c.close - c.open);
  var range = c.high - c.low;
  return range > 0 && c.close > c.open && body / range > 0.6;
}

function isStrongBear(c) {
  if (!c) return false;
  var body = Math.abs(c.close - c.open);
  var range = c.high - c.low;
  return range > 0 && c.close < c.open && body / range > 0.6;
}

function bullishRejection(c) {
  if (!c) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var lowerWick = Math.min(c.open, c.close) - c.low;
  return lowerWick / range > 0.35;
}

function bearishRejection(c) {
  if (!c) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var upperWick = c.high - Math.max(c.open, c.close);
  return upperWick / range > 0.35;
}

function volumeSpike(data) {
  if (!data || data.length < 10) return false;
  var last = data[data.length - 1];
  var avg = data.slice(-10).reduce(function(a, b) { return a + b.volume; }, 0) / 10;
  return last.volume > avg * LAB_CONFIG.volume_multiplier;
}

function fakeBreakoutShort(c, resistance) {
  if (!c || !resistance) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var upperWick = c.high - Math.max(c.open, c.close);
  return c.high > resistance && c.close < resistance && upperWick / range > 0.4;
}

function fakeBreakoutLong(c, support) {
  if (!c || !support) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var lowerWick = Math.min(c.open, c.close) - c.low;
  return c.low < support && c.close > support && lowerWick / range > 0.4;
}

function nearResistance(price, resistance) {
  if (!price || !resistance) return false;
  return price >= resistance * 0.997;
}

function nearSupport(price, support) {
  if (!price || !support) return false;
  return price <= support * 1.003;
}

function antiLongFilter(c, resistance) {
  if (isStrongBull(c) && nearResistance(c.close, resistance)) return true;
  if (c.close < c.open && volumeSpike([c])) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var upperWick = c.high - Math.max(c.open, c.close);
  return upperWick / range > 0.45;
}

function antiShortFilter(c, support) {
  if (isStrongBear(c) && nearSupport(c.close, support)) return true;
  var range = c.high - c.low;
  if (range === 0) return false;
  var lowerWick = Math.min(c.open, c.close) - c.low;
  return lowerWick / range > 0.45;
}

function detectRetrace(candles, direction) {
  if (!candles || candles.length < 5) return false;
  var c = candles[candles.length - 1];
  var ema5 = calcEMA(candles.map(function(x) { return x.close; }), 5);
  var ema10 = calcEMA(candles.map(function(x) { return x.close; }), 10);
  if (!ema5 || !ema10) return false;
  if (direction === "LONG") {
    return c.close > c.open && c.close > ema5 && c.low < ema5 * 1.002 && c.low > ema10 * 0.998;
  }
  if (direction === "SHORT") {
    return c.close < c.open && c.close < ema5 && c.high < ema5 * 1.002 && c.high > ema10 * 0.998;
  }
  return false;
}

function getLabSignal(data) {
  var candles5m = data.candles5m;
  var candles15m = data.candles15m;
  var support = data.support;
  var resistance = data.resistance;

  if (!candles5m || candles5m.length < 32 || !candles15m || candles15m.length < 32) {
    return null;
  }

  var c5 = candles5m[candles5m.length - 1];
  var prev5 = candles5m[candles5m.length - 2];
  var trend15m = getTrendBias(candles15m);
  var trend5m = getTrendBias(candles5m);
  var atr = getATR(candles5m);

  if (!atr) return null;

  var score = { long: 0, short: 0 };
  var reasons = [];

  if (trend15m === "LONG" || trend5m === "LONG") {
    score.long += 2;
    reasons.push("bull_trend");
  }
  if (trend15m === "SHORT" || trend5m === "SHORT") {
    score.short += 2;
    reasons.push("bear_trend");
  }

  if (bullishRejection(c5)) {
    score.long += 1;
    reasons.push("bull_reject");
  }
  if (bearishRejection(c5)) {
    score.short += 1;
    reasons.push("bear_reject");
  }

  if (isStrongBull(c5)) {
    score.long += 1;
    reasons.push("strong_bull");
  }
  if (isStrongBear(c5)) {
    score.short += 1;
    reasons.push("strong_bear");
  }

  if (volumeSpike(candles5m)) {
    score.long += 1;
    score.short += 1;
    reasons.push("vol_spike");
  }

  if (fakeBreakoutShort(c5, resistance)) {
    score.short += 3;
    reasons.push("fake_break_short");
  }
  if (fakeBreakoutLong(c5, support)) {
    score.long += 3;
    reasons.push("fake_break_long");
  }

  if (detectRetrace(candles5m, "LONG")) {
    score.long += 2;
    reasons.push("retrace_long");
  }
  if (detectRetrace(candles5m, "SHORT")) {
    score.short += 2;
    reasons.push("retrace_short");
  }

  var direction = "WAIT";
  if (score.long >= LAB_CONFIG.min_score && score.long > score.short) {
    direction = "LONG";
  }
  if (score.short >= LAB_CONFIG.min_score && score.short > score.long) {
    direction = "SHORT";
  }

  if (antiLongFilter(c5, resistance) && direction === "LONG") {
    direction = "WAIT";
    reasons.push("anti_long_filter");
  }
  if (antiShortFilter(c5, support) && direction === "SHORT") {
    direction = "WAIT";
    reasons.push("anti_short_filter");
  }

  var entry = c5.close;
  var sl = null;
  var tp = null;

  if (direction === "LONG") {
    sl = round(entry - atr * LAB_CONFIG.atr_sl);
    tp = round(entry + atr * LAB_CONFIG.atr_tp);
  }
  if (direction === "SHORT") {
    sl = round(entry + atr * LAB_CONFIG.atr_sl);
    tp = round(entry - atr * LAB_CONFIG.atr_tp);
  }

  var rr = null;
  if (sl && tp && entry) {
    rr = round(Math.abs(tp - entry) / Math.abs(entry - sl));
  }

  if (direction !== "WAIT" && rr !== null && rr < LAB_CONFIG.min_rr) {
    direction = "WAIT";
    reasons.push("rr_low");
  }

  return {
    type: direction,
    direction: direction,
    entry: entry,
    tp: tp,
    sl: sl,
    rr: rr,
    score: score,
    score_long: score.long,
    score_short: score.short,
    reasons: reasons,
    trend15m: trend15m,
    trend5m: trend5m,
    atr: atr,
    support: support,
    resistance: resistance,
    status: direction === "WAIT" ? "WAIT" : "ENTRY",
    signal_name: "LAB SNIPER"
  };
}

function round(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

function buildLabCard(signal) {
  if (!signal) return null;
  return {
    pair: "LABUSDT",
    direction: signal.direction,
    score: signal.direction === "LONG" ? signal.score_long : signal.score_short,
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    rr: signal.rr,
    trend: signal.trend15m,
    mode: "LAB SNIPER",
    reason: signal.reasons ? signal.reasons.join(", ") : signal.signal_name,
    status: signal.status,
    signal_name: signal.signal_name,
    atr: signal.atr,
    support: signal.support,
    resistance: signal.resistance,
    ob: null,
    fvg: null,
    candle: null
  };
}

function calculatePositionSize(entry, sl, balance) {
  if (!entry || !sl || !balance) return 0;
  var riskCapital = balance * LAB_CONFIG.risk_per_trade;
  var riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit === 0) return 0;
  return round(riskCapital / riskPerUnit, 2);
}

function updateTrailingStop(position, currentPrice) {
  if (!position || !currentPrice) return position;
  var atr = position.atr || getATR([{high: currentPrice, low: currentPrice, close: currentPrice}], 14);
  if (!atr) return position;

  if (position.side === "LONG") {
    var profit = currentPrice - position.entry;
    if (profit > atr * LAB_CONFIG.trailing_trigger) {
      var newSL = round(currentPrice - atr * LAB_CONFIG.trailing_distance);
      if (newSL > position.sl) {
        position.sl = newSL;
      }
    }
  }
  if (position.side === "SHORT") {
    var profit = position.entry - currentPrice;
    if (profit > atr * LAB_CONFIG.trailing_trigger) {
      var newSL = round(currentPrice + atr * LAB_CONFIG.trailing_distance);
      if (newSL < position.sl) {
        position.sl = newSL;
      }
    }
  }
  return position;
}

module.exports = {
  LAB_CONFIG: LAB_CONFIG,
  getTrendBias: getTrendBias,
  getATR: getATR,
  getLabSignal: getLabSignal,
  buildLabCard: buildLabCard,
  calculatePositionSize: calculatePositionSize,
  updateTrailingStop: updateTrailingStop,
  isStrongBull: isStrongBull,
  isStrongBear: isStrongBear,
  bullishRejection: bullishRejection,
  bearishRejection: bearishRejection,
  volumeSpike: volumeSpike,
  fakeBreakoutShort: fakeBreakoutShort,
  fakeBreakoutLong: fakeBreakoutLong
};