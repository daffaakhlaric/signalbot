// ── HTF Bias Detection ──────────────────────────────────────────
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

function emaCalc(values, period) {
  if (values.length < period) return null;
  var k = 2 / (period + 1);
  var e = values.slice(0, period).reduce(function(a, b) { return a + b; }) / period;
  var i;
  for (i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function getHTFBias(candles) {
  if (!candles || candles.length < 50) return "NEUTRAL";

  var closes = candles.map(function(c) { return c.close; });
  var highs = candles.map(function(c) { return c.high; });
  var lows = candles.map(function(c) { return c.low; });

  var ema20 = emaCalc(closes.slice(-50), 20);
  var ema50 = emaCalc(closes.slice(-50), 50);
  var lastClose = closes[closes.length - 1];

  if (!ema20 || !ema50) return "NEUTRAL";

  // EMA alignment check
  var emaBull = ema20 > ema50 && lastClose > ema20;
  var emaBear = ema20 < ema50 && lastClose < ema20;

  // Recent structure check
  var recentHighs = highs.slice(-20);
  var recentLows = lows.slice(-20);
  var highest = Math.max.apply(null, recentHighs);
  var lowest = Math.min.apply(null, recentLows);

  // Break of structure bias
  var bullStructure = lastClose > highest * 0.998;
  var bearStructure = lastClose < lowest * 1.002;

  if (emaBull || bullStructure) return "LONG";
  if (emaBear || bearStructure) return "SHORT";

  return "NEUTRAL";
}

function getStructure(candles) {
  if (!candles || candles.length < 20) return "NA";

  var highs = candles.map(function(c) { return c.high; });
  var lows = candles.map(function(c) { return c.low; });

  var recentH = highs.slice(-10);
  var priorH = highs.slice(-20, -10);
  var recentL = lows.slice(-10);
  var priorL = lows.slice(-20, -10);

  var maxRH = Math.max.apply(null, recentH);
  var maxRL = Math.min.apply(null, recentL);
  var maxPH = Math.max.apply(null, priorH);
  var maxPL = Math.min.apply(null, priorL);

  if (maxRH > maxPH && maxRL > maxPL) return "HH";
  if (maxRH < maxPH && maxRL < maxPL) return "LL";
  if (maxRH > maxPH) return "LH";
  if (maxRL < maxPL) return "HL";

  return "NA";
}

module.exports = {
  getHTFBias: getHTFBias,
  getStructure: getStructure
};