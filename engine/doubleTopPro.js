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

function detectDoubleTopPro(candles) {
  var pivots = getPivots(candles);
  var highs = pivots.filter(function(p) { return p.type === "HIGH"; });
  if (highs.length < 2) return null;

  var h1 = highs[highs.length - 2];
  var h2 = highs[highs.length - 1];
  var tolerance = h2.price * 0.003;
  if (Math.abs(h1.price - h2.price) > tolerance) return null;

  var necklineCand = pivots.filter(function(p) {
    return p.type === "LOW" && p.index > h1.index && p.index < h2.index;
  });
  if (!necklineCand.length) return null;
  var neckline = necklineCand.reduce(function(a, b) { return a.price < b.price ? a : b; });

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];

  // STRICT break — must be strictly above neckline
  var breakConfirmed = last.close > neckline.price;

  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close >= neckline.price - retestZone && last.close <= neckline.price + retestZone;

  var hadPullback = false;
  if (prev && breakConfirmed) {
    var touchedNeckline = prev.high >= neckline.price && prev.close < neckline.price;
    hadPullback = touchedNeckline || atNeckline;
  }

  var entry = last.close;
  var height = h2.price - neckline.price;
  var tp = entry - height;
  var sl = h2.price * 1.0007;
  var rr = Math.abs(entry - tp) / Math.abs(sl - entry);

  if (!breakConfirmed) {
    return {
      type: "DOUBLE_TOP",
      status: "PLAN",
      direction: "SHORT",
      neckline: neckline.price,
      entry: null, tp: null, sl: null, rr: null,
      confidence: 0.5,
      reason: "waiting break above neckline @ " + round(neckline.price, 2)
    };
  }

  if (!hadPullback && !atNeckline) {
    return {
      type: "DOUBLE_TOP",
      status: "PLAN",
      direction: "SHORT",
      neckline: neckline.price,
      entry: null, tp: null, sl: null, rr: null,
      confidence: 0.6,
      reason: "waiting retest at neckline @ " + round(neckline.price, 2)
    };
  }

  return {
    type: "DOUBLE_TOP",
    status: "ENTRY",
    direction: "SHORT",
    neckline: neckline.price,
    entry: round(entry, 2),
    tp: round(tp, 2),
    sl: round(sl, 2),
    rr: round(rr, 2),
    confidence: 0.85,
    pattern: "DOUBLE_TOP",
    reason: "double top confirmed"
  };
}

module.exports = { detectDoubleTopPro: detectDoubleTopPro };