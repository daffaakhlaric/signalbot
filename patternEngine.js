// ── Pattern Engine (Master Brain) ────────────────────────────
// Consolidated — all pattern detection inline
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

  // STRICT break — price closes BELOW neckline (bearish breakdown for short)
  var breakConfirmed = last.close < neckline.price;

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
      type: "DOUBLE_TOP", status: "PLAN", direction: "SHORT",
      neckline: neckline.price, entry: null, tp: null, sl: null, rr: null,
      confidence: 0.5, reason: "waiting break below neckline @ " + round(neckline.price, 2)
    };
  }
  if (!hadPullback && !atNeckline) {
    return {
      type: "DOUBLE_TOP", status: "PLAN", direction: "SHORT",
      neckline: neckline.price, entry: null, tp: null, sl: null, rr: null,
      confidence: 0.6, reason: "waiting retest at neckline @ " + round(neckline.price, 2)
    };
  }

  return {
    type: "DOUBLE_TOP", status: "ENTRY", direction: "SHORT",
    neckline: neckline.price,
    entry: round(entry, 2), tp: round(tp, 2), sl: round(sl, 2), rr: round(rr, 2),
    confidence: 0.85, pattern: "DOUBLE_TOP", reason: "double top confirmed"
  };
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

  // STRICT break — price closes ABOVE neckline (bullish breakout for long)
  var breakConfirmed = last.close > neckline.price;

  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close >= neckline.price - retestZone && last.close <= neckline.price + retestZone;

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
      type: "DOUBLE_BOTTOM", status: "PLAN", direction: "LONG",
      neckline: neckline.price, entry: null, tp: null, sl: null, rr: null,
      confidence: 0.5, reason: "waiting break above neckline @ " + round(neckline.price, 2)
    };
  }
  if (!hadPullback && !atNeckline) {
    return {
      type: "DOUBLE_BOTTOM", status: "PLAN", direction: "LONG",
      neckline: neckline.price, entry: null, tp: null, sl: null, rr: null,
      confidence: 0.6, reason: "waiting retest at neckline @ " + round(neckline.price, 2)
    };
  }

  return {
    type: "DOUBLE_BOTTOM", status: "ENTRY", direction: "LONG",
    neckline: neckline.price,
    entry: round(entry, 2), tp: round(tp, 2), sl: round(sl, 2), rr: round(rr, 2),
    confidence: 0.85, pattern: "DOUBLE_BOTTOM", reason: "double bottom confirmed"
  };
}

function detectTrianglePro(candles) {
  var pivots = getPivots(candles);
  var highs = pivots.filter(function(p) { return p.type === "HIGH"; }).slice(-3);
  var lows = pivots.filter(function(p) { return p.type === "LOW"; }).slice(-3);
  if (highs.length < 2 || lows.length < 2) return null;

  var descHighs = highs[0].price > highs[highs.length - 1].price;
  var ascLows = lows[0].price < lows[lows.length - 1].price;
  if (!(descHighs && ascLows)) return null;

  var upper = highs[highs.length - 1].price;
  var lower = lows[lows.length - 1].price;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];

  // LONG breakout: close ABOVE upper + fake breakout filter
  if (last.close > upper) {
    if (prev && last.high > upper && last.close < upper) {
      return {
        type: "TRIANGLE", status: "PLAN", direction: "NEUTRAL",
        reason: "fake breakout above — rejected",
        confidence: 0.4
      };
    }
    return {
      type: "TRIANGLE_UP", status: "ENTRY", direction: "LONG",
      entry: round(last.close, 2),
      tp: round(last.close + (upper - lower), 2), sl: round(lower, 2),
      rr: 2, confidence: 0.75, pattern: "TRIANGLE", reason: "triangle upside breakout"
    };
  }

  // SHORT breakdown: close BELOW lower + fake breakdown filter
  if (last.close < lower) {
    if (prev && last.low < lower && last.close > lower) {
      return {
        type: "TRIANGLE", status: "PLAN", direction: "NEUTRAL",
        reason: "fake breakdown below — rejected",
        confidence: 0.4
      };
    }
    return {
      type: "TRIANGLE_DOWN", status: "ENTRY", direction: "SHORT",
      entry: round(last.close, 2),
      tp: round(last.close - (upper - lower), 2), sl: round(upper, 2),
      rr: 2, confidence: 0.75, pattern: "TRIANGLE", reason: "triangle downside breakout"
    };
  }

  // Check for liquidity sweep near upper/lower
  if (prev) {
    // Liquidity sweep above upper then reversal
    if (last.high > upper && last.close < upper && last.close < last.open) {
      return {
        type: "TRIANGLE", status: "PLAN", direction: "SHORT",
        reason: "liquidity sweep above upper — waiting",
        confidence: 0.5
      };
    }
    // Liquidity sweep below lower then reversal
    if (last.low < lower && last.close > lower && last.close > last.open) {
      return {
        type: "TRIANGLE", status: "PLAN", direction: "LONG",
        reason: "liquidity sweep below lower — waiting",
        confidence: 0.5
      };
    }
  }

  return {
    type: "TRIANGLE", status: "PLAN", direction: "NEUTRAL",
    reason: "waiting triangle breakout", confidence: 0.5
  };
}

function detectLiquiditySweep(candles) {
  if (candles.length < 3) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];

  if (!last || !prev) return null;

  // Check prev high — if last spiked above prev high then reversed = liquidity grab for short
  if (prev2 && prev.high > prev2.high) {
    if (last.high > prev.high && last.close < prev.high && last.close < last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        direction: "SHORT",
        status: "ENTRY",
        entry: round(last.close, 2),
        tp: round(last.close - (prev.high - prev.low) * 0.5, 2),
        sl: round(last.high * 1.001, 2),
        rr: 1.5,
        confidence: 0.7,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep above prev high — short"
      };
    }
  }

  // Check prev low — if last spiked below prev low then reversed = liquidity grab for long
  if (prev2 && prev.low < prev2.low) {
    if (last.low < prev.low && last.close > prev.low && last.close > last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        direction: "LONG",
        status: "ENTRY",
        entry: round(last.close, 2),
        tp: round(last.close + (prev.high - prev.low) * 0.5, 2),
        sl: round(last.low * 0.999, 2),
        rr: 1.5,
        confidence: 0.7,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep below prev low — long"
      };
    }
  }

  return null;
}

function runPatternEngine(candles) {
  var patterns = [
    detectDoubleTopPro(candles),
    detectDoubleBottomPro(candles),
    detectTrianglePro(candles),
    detectLiquiditySweep(candles),
  ].filter(Boolean);

  if (!patterns.length) {
    return { status: "WAIT", reason: "no pattern" };
  }

  var entries = patterns.filter(function(p) { return p.status === "ENTRY"; });
  var pool = entries.length ? entries : patterns;

  var best = null;
  for (var i = 0; i < pool.length; i++) {
    var p = pool[i];
    var score = (p.confidence || 0) + Math.min(1, (p.rr || 0) / 3);
    if (!best || score > best.score) best = { score: score, ...p };
  }

  if (best.status !== "ENTRY") {
    return { status: "WAIT", reason: best.reason || "waiting confirmation" };
  }

  return {
    status: "ENTRY",
    source: "PATTERN",
    direction: best.direction,
    entry: best.entry,
    tp: best.tp,
    sl: best.sl,
    rr: best.rr,
    score: Math.round(best.score),
    pattern: best.pattern || best.type,
    reason: best.reason
  };
}

module.exports = { runPatternEngine: runPatternEngine };