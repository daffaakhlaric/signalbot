function detectFakeBreakout(candles) {
  if (!candles || candles.length < 5) return null;

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  var lastHigh = last.high;
  var lastLow = last.low;
  var prevHigh = prev.high;
  var prevLow = prev.low;
  var lastClose = last.close;
  var prevClose = prev.close;
  var prevOpen = prev.open;

  if (lastHigh > prevHigh && lastClose < prevHigh) {
    return {
      type: "FAKE_BREAKOUT",
      direction: "SHORT",
      reason: "break high then rejection"
    };
  }

  if (lastLow < prevLow && lastClose > prevLow) {
    return {
      type: "FAKE_BREAKOUT",
      direction: "LONG",
      reason: "break low then rejection"
    };
  }

  return null;
}

module.exports = { detectFakeBreakout };
