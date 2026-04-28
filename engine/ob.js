// ── Order Block Detection ────────────────────────────────────────
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

function detectOrderBlock(candles) {
  if (!candles || candles.length < 20) return null;

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var obCandle = candles[candles.length - 3];

  if (!last || !prev || !obCandle) return null;

  // Bullish OB: price breaks above previous high after impulse
  if (last.close > prev.high && obCandle.close > obCandle.open) {
    return {
      type: "OB",
      status: "ACTIVE",
      direction: "LONG",
      zone: [round(obCandle.low, 2), round(obCandle.high, 2)],
      entry: round(obCandle.low, 2),
      tp: round(last.close + (obCandle.high - obCandle.low) * 2, 2),
      sl: round(obCandle.low * 0.998, 2),
      rr: round((last.close + (obCandle.high - obCandle.low) * 2 - obCandle.low) / (obCandle.low - obCandle.low * 0.998), 2),
      confidence: 0.25,
      pattern: "ORDER_BLOCK",
      reason: "bullish order block detected"
    };
  }

  // Bearish OB: price breaks below previous low after impulse
  if (last.close < prev.low && obCandle.close < obCandle.open) {
    return {
      type: "OB",
      status: "ACTIVE",
      direction: "SHORT",
      zone: [round(obCandle.low, 2), round(obCandle.high, 2)],
      entry: round(obCandle.high, 2),
      tp: round(last.close - (obCandle.high - obCandle.low) * 2, 2),
      sl: round(obCandle.high * 1.002, 2),
      rr: round((obCandle.high - (last.close - (obCandle.high - obCandle.low) * 2)) / (obCandle.high * 1.002 - obCandle.high), 2),
      confidence: 0.25,
      pattern: "ORDER_BLOCK",
      reason: "bearish order block detected"
    };
  }

  return null;
}

module.exports = { detectOrderBlock: detectOrderBlock };