// ── Decision Engine (PRO) — Single Source of Truth ───────────
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

  // BEARISH breakdown — price closes BELOW neckline for SHORT
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

  // BULLISH breakout — price closes ABOVE neckline for LONG
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

  // Liquidity sweep near upper/lower
  if (prev) {
    if (last.high > upper && last.close < upper && last.close < last.open) {
      return {
        type: "TRIANGLE", status: "PLAN", direction: "SHORT",
        reason: "liquidity sweep above upper — waiting",
        confidence: 0.5
      };
    }
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
  if (!last || !prev || !prev2) return null;

  // Short sweep: spike above prev high then reject
  if (prev.high > prev2.high) {
    if (last.high > prev.high && last.close < prev.high && last.close < last.open) {
      return {
        type: "LIQUIDITY_SWEEP", status: "ENTRY", direction: "SHORT",
        entry: round(last.close, 2),
        tp: round(last.close - (prev.high - prev.low) * 0.5, 2),
        sl: round(last.high * 1.001, 2),
        rr: 1.5, confidence: 0.7, pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep short"
      };
    }
  }

  // Long sweep: spike below prev low then bounce
  if (prev.low < prev2.low) {
    if (last.low < prev.low && last.close > prev.low && last.close > last.open) {
      return {
        type: "LIQUIDITY_SWEEP", status: "ENTRY", direction: "LONG",
        entry: round(last.close, 2),
        tp: round(last.close + (prev.high - prev.low) * 0.5, 2),
        sl: round(last.low * 0.999, 2),
        rr: 1.5, confidence: 0.7, pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep long"
      };
    }
  }

  return null;
}

function isConfirmationCandle(candles, dir) {
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return false;

  var body = Math.abs(last.close - last.open);
  var range = last.high - last.low;
  if (range === 0) return false;
  var bodyPct = body / range;
  var upperWick = last.high - Math.max(last.close, last.open);
  var lowerWick = Math.min(last.close, last.open) - last.low;
  var upperPct = upperWick / range;
  var lowerPct = lowerWick / range;

  if (dir === "LONG") {
    return (lowerPct > 0.3 && bodyPct < 0.65 && last.close > last.open) ||
           (last.close > last.open && prev.close < prev.open &&
            last.close > prev.open && last.open < prev.close);
  }
  if (dir === "SHORT") {
    return (upperPct > 0.3 && bodyPct < 0.65 && last.close < last.open) ||
           (last.close < last.open && prev.close > prev.open &&
            last.close < prev.open && last.open > prev.close);
  }
  return false;
}

function buildDecision(opts) {
  var candles = opts.candles;
  var sniper = opts.sniper;
  var payload = opts.payload;
  var htfBias = opts.htfBias || "NEUTRAL";
  var range = payload.resistance - payload.support;

  if (!candles || candles.length < 20) {
    return { status: "WAIT", direction: "NEUTRAL", confidence: "LOW", source: "NONE", reason: "insufficient data" };
  }

  var patterns = [
    detectDoubleTopPro(candles),
    detectDoubleBottomPro(candles),
    detectTrianglePro(candles),
    detectLiquiditySweep(candles),
  ].filter(Boolean);

  var entryPatterns = patterns.filter(function(p) { return p.status === "ENTRY"; });
  var planPatterns = patterns.filter(function(p) { return p.status === "PLAN"; });

  // ══════════════════════════════════════════════════════════
  // PRIORITY 1: PATTERN IS KING — absolute override
  // When pattern confirms ENTRY, it overrides sniper completely
  // ══════════════════════════════════════════════════════════
  if (entryPatterns.length > 0) {
    var best = entryPatterns.reduce(function(a, b) {
      var scoreA = (a.confidence || 0) + Math.min(1, (a.rr || 0) / 3);
      var scoreB = (b.confidence || 0) + Math.min(1, (b.rr || 0) / 3);
      return scoreA > scoreB ? a : b;
    });

    var confirmed = isConfirmationCandle(candles, best.direction);

    // CONFLICT FILTER: sniper direction vs pattern direction
    if (sniper && sniper.preferred && sniper.preferred !== best.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "PATTERN",
        reason: "conflict: " + best.direction + " pattern but sniper " + sniper.preferred + " — waiting resolution",
        extra: {
          neckline: best.neckline || null,
          patternType: best.pattern || best.type,
          conflict: true
        }
      };
    }

    // HTF FILTER: reject counter-trend pattern entries
    if (htfBias !== "NEUTRAL" && htfBias !== best.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "PATTERN",
        reason: "HTF conflict: " + best.direction + " pattern vs HTF " + htfBias + " — waiting",
        extra: {
          neckline: best.neckline || null,
          patternType: best.pattern || best.type,
          htfConflict: true
        }
      };
    }

    return {
      status: confirmed ? "ENTRY" : "PLAN",
      direction: best.direction,
      entry: best.entry,
      tp: best.tp,
      sl: best.sl,
      rr: best.rr,
      confidence: confirmed ? "HIGH" : "MEDIUM",
      source: "PATTERN_MASTER",
      reason: best.reason,
      extra: {
        neckline: best.neckline || null,
        patternType: best.pattern || best.type,
        confirmed: confirmed,
        patternOverride: true
      }
    };
  }

  // ══════════════════════════════════════════════════════════
  // PRIORITY 2: SNIPER ACTIVE — only if no pattern ENTRY
  // ══════════════════════════════════════════════════════════
  if (sniper && (sniper.status && sniper.status.indexOf("ACTIVE") !== -1 || sniper.status && sniper.status.indexOf("READY") !== -1)) {
    var preferred = sniper.preferred;
    if (preferred === "LONG" || preferred === "SHORT") {
      var conf = isConfirmationCandle(candles, preferred);
      return {
        status: conf ? "ENTRY" : "PLAN",
        direction: preferred,
        entry: payload.close,
        tp: preferred === "LONG" ? round(payload.close + range * 0.4, 2) : round(payload.close - range * 0.4, 2),
        sl: preferred === "LONG" ? payload.support : payload.resistance,
        rr: 1.5,
        confidence: conf ? "HIGH" : "MEDIUM",
        source: "SNIPER",
        reason: sniper.reason || "sniper zone active",
        extra: { sniperStatus: sniper.status }
      };
    }
  }

  // ══════════════════════════════════════════════════════════
  // PRIORITY 3: PATTERN PLAN — waiting for break
  // ══════════════════════════════════════════════════════════
  if (planPatterns.length > 0) {
    var bp = planPatterns[0];
    return {
      status: "WAIT",
      direction: bp.direction || "NEUTRAL",
      confidence: "LOW",
      source: "PATTERN",
      reason: bp.reason,
      extra: {
        neckline: bp.neckline || null,
        patternType: bp.pattern || bp.type,
        planWaiting: true
      }
    };
  }

  return {
    status: "WAIT",
    direction: "NEUTRAL",
    confidence: "LOW",
    source: "NONE",
    reason: "no valid setup — waiting confluence"
  };
}

module.exports = { buildDecision: buildDecision };