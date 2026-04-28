const round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

function getPivots(data, left, right) {
  left = left || 3;
  right = right || 3;
  var pivots = [];
  for (var i = left; i < data.length - right; i++) {
    var slice = data.slice(i - left, i + right + 1);
    var isHigh = slice.every(function(c) { return data[i].high >= c.high; });
    var isLow = slice.every(function(c) { return data[i].low <= c.low; });
    if (isHigh) pivots.push({ type: "HIGH", price: data[i].high, index: i });
    if (isLow) pivots.push({ type: "LOW", price: data[i].low, index: i });
  }
  return pivots;
}

function detectDoubleBottomPro(candles) {
  var pivots = getPivots(candles);
  var lows = pivots.filter(function(p) { return p.type === "LOW"; });
  if (lows.length < 2) return null;

  var l1 = lows[lows.length - 2];
  var l2 = lows[lows.length - 1];
  var tolerance = l2.price * 0.003;
  if (Math.abs(l1.price - l2.price) > tolerance) return null;

  var necklineCand = pivots.filter(function(p) {
    return p.type === "HIGH" && p.index > l1.index && p.index < l2.index;
  });
  if (!necklineCand.length) return null;
  var neckline = necklineCand.reduce(function(a, b) { return a.price > b.price ? a : b; });

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];

  // FIX: strict break — must be STRICTLY below neckline (not >=)
  var breakConfirmed = last.close < neckline.price;

  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close <= neckline.price + retestZone && last.close >= neckline.price - retestZone;

  var hadPullback = false;
  if (prev && breakConfirmed) {
    var touchedNeckline = prev.low <= neckline.price && prev.close > neckline.price;
    hadPullback = touchedNeckline || atNeckline;
  }

  var entry = last.close;
  var height = neckline.price - l2.price;
  var tp = entry + height;
  var sl = l2.price * 0.9993;
  var rr = Math.abs(tp - entry) / Math.abs(entry - sl);

  if (!breakConfirmed) {
    return {
      type: "DOUBLE_BOTTOM",
      status: "PLAN",
      neckline: neckline.price,
      entry: null, tp: null, sl: null, rr: null,
      confidence: 0.5,
      reason: "waiting break below neckline @ " + round(neckline.price, 2)
    };
  }

  if (!hadPullback && !atNeckline) {
    return {
      type: "DOUBLE_BOTTOM",
      status: "PLAN",
      neckline: neckline.price,
      entry: null, tp: null, sl: null, rr: null,
      confidence: 0.6,
      reason: "waiting retest at neckline @ " + round(neckline.price, 2)
    };
  }

  return {
    type: "DOUBLE_BOTTOM",
    status: "ENTRY",
    direction: "LONG",
    neckline: neckline.price,
    entry: round(entry, 2),
    tp: round(tp, 2),
    sl: round(sl, 2),
    rr: round(rr, 2),
    confidence: 0.85,
    pattern: "DOUBLE_BOTTOM",
    reason: "double bottom confirmed"
  };
}

module.exports = { detectDoubleBottomPro: detectDoubleBottomPro };