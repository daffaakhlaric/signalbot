// ── Order Block Detection ────────────────────────────────────────
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

function detectOrderBlock(candles) {
  if (!candles || candles.length < 20) return null;

  var closedCandle = candles[candles.length - 2];
  var prevCandle = candles[candles.length - 3];
  var obCandle = candles[candles.length - 4];

  if (!closedCandle || !prevCandle || !obCandle) return null;

  var range = closedCandle.high - closedCandle.low;
  var body = Math.abs(closedCandle.close - closedCandle.open);
  var bodyPct = range > 0 ? body / range : 0;
  var isImpulse = bodyPct > 0.3;

  if (!isImpulse) return null;

  var lastClose = closedCandle.close;
  var lastHigh = closedCandle.high;
  var lastLow = closedCandle.low;

  if (lastClose > prevCandle.high && obCandle.close > obCandle.open) {
    var obRange = obCandle.high - obCandle.low;
    var retraceEntry = obCandle.low + obRange * 0.3;
    var tpDistance = obRange * 2;
    var slDistance = obCandle.low * 0.002;

    return {
      type: "OB",
      status: "ACTIVE",
      direction: "LONG",
      zone: [round(obCandle.low, 2), round(obCandle.high, 2)],
      entry: round(retraceEntry, 2),
      tp: round(lastClose + tpDistance, 2),
      sl: round(obCandle.low - slDistance, 2),
      rr: round(tpDistance / (retraceEntry - (obCandle.low - slDistance)), 2),
      confidence: 0.3,
      pattern: "ORDER_BLOCK",
      reason: "bullish order block + impulse confirmed",
      impulse_pct: round(bodyPct * 100, 0) + "%"
    };
  }

  if (lastClose < prevCandle.low && obCandle.close < obCandle.open) {
    var obRange = obCandle.high - obCandle.low;
    var retraceEntry = obCandle.high - obRange * 0.3;
    var tpDistance = obRange * 2;
    var slDistance = obCandle.high * 0.002;

    return {
      type: "OB",
      status: "ACTIVE",
      direction: "SHORT",
      zone: [round(obCandle.low, 2), round(obCandle.high, 2)],
      entry: round(retraceEntry, 2),
      tp: round(lastClose - tpDistance, 2),
      sl: round(obCandle.high + slDistance, 2),
      rr: round(tpDistance / ((obCandle.high + slDistance) - retraceEntry), 2),
      confidence: 0.3,
      pattern: "ORDER_BLOCK",
      reason: "bearish order block + impulse confirmed",
      impulse_pct: round(bodyPct * 100, 0) + "%"
    };
  }

  return null;
}

module.exports = { detectOrderBlock: detectOrderBlock };