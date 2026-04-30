// ── Fair Value Gap Detection ─────────────────────────────────────
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

function detectFVG(candles) {
  if (!candles || candles.length < 20) return null;

  var c1 = candles[candles.length - 4];
  var c2 = candles[candles.length - 3];
  var c3 = candles[candles.length - 2];
  var lastCandle = candles[candles.length - 1];

  if (!c1 || !c2 || !c3 || !lastCandle) return null;

  var range = c3.high - c3.low;
  var body = Math.abs(c3.close - c3.open);
  var bodyPct = range > 0 ? body / range : 0;
  var isImpulse = bodyPct > 0.5;

  if (!isImpulse) return null;

  if (c1.high < c3.low) {
    return {
      type: "FVG",
      status: "ACTIVE",
      direction: "LONG",
      zone: [round(c1.high, 2), round(c3.low, 2)],
      mid: round((c1.high + c3.low) / 2, 2),
      confidence: 0.25,
      pattern: "FVG",
      reason: "bullish FVG + impulse confirmed",
      impulse_pct: round(bodyPct * 100, 0) + "%"
    };
  }

  if (c1.low > c3.high) {
    return {
      type: "FVG",
      status: "ACTIVE",
      direction: "SHORT",
      zone: [round(c3.high, 2), round(c1.low, 2)],
      mid: round((c3.high + c1.low) / 2, 2),
      confidence: 0.25,
      pattern: "FVG",
      reason: "bearish FVG + impulse confirmed",
      impulse_pct: round(bodyPct * 100, 0) + "%"
    };
  }

  return null;
}

module.exports = { detectFVG: detectFVG };