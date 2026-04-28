// ── Decision Engine (MASTER BRAIN) — Single Source of Truth ───
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

// ══════════════════════════════════════════════════════════
// SMC DETECTION ENGINE
// ══════════════════════════════════════════════════════════

function detectLiquiditySweep(candles) {
  if (candles.length < 3) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  if (!last || !prev || !prev2) return null;

  // Short sweep: spike above prev high then reject below
  if (prev.high > prev2.high) {
    if (last.high > prev.high && last.close < prev.high && last.close < last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        status: "ENTRY",
        direction: "SHORT",
        entry: round(last.close, 2),
        tp: round(last.close - (prev.high - prev.low) * 0.5, 2),
        sl: round(last.high * 1.001, 2),
        rr: 1.5,
        confidence: 0.75,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep short"
      };
    }
  }

  // Long sweep: spike below prev low then bounce above
  if (prev.low < prev2.low) {
    if (last.low < prev.low && last.close > prev.low && last.close > last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        status: "ENTRY",
        direction: "LONG",
        entry: round(last.close, 2),
        tp: round(last.close + (prev.high - prev.low) * 0.5, 2),
        sl: round(last.low * 0.999, 2),
        rr: 1.5,
        confidence: 0.75,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep long"
      };
    }
  }

  return null;
}

function detectInducement(candles) {
  if (candles.length < 2) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  // Short inducement: push above prev high, reject down
  if (last.high > prev.high && last.close < prev.close && last.close < last.open) {
    return {
      type: "INDUCEMENT_SHORT",
      status: "ENTRY",
      direction: "SHORT",
      confidence: 0.7,
      pattern: "INDUCEMENT",
      reason: "inducement short"
    };
  }

  // Long inducement: push below prev low, bounce up
  if (last.low < prev.low && last.close > prev.close && last.close > last.open) {
    return {
      type: "INDUCEMENT_LONG",
      status: "ENTRY",
      direction: "LONG",
      confidence: 0.7,
      pattern: "INDUCEMENT",
      reason: "inducement long"
    };
  }

  return null;
}

function detectBOS(candles) {
  if (candles.length < 10) return null;
  var last = candles[candles.length - 1];
  var prevCandles = candles.slice(-10, -1);
  var prevHigh = Math.max.apply(null, prevCandles.map(function(c) { return c.high; }));
  var prevLow = Math.min.apply(null, prevCandles.map(function(c) { return c.low; }));

  if (last.close > prevHigh) {
    return {
      type: "BOS",
      status: "ENTRY",
      direction: "LONG",
      confidence: 0.8,
      pattern: "BOS",
      reason: "BOS upside"
    };
  }
  if (last.close < prevLow) {
    return {
      type: "BOS",
      status: "ENTRY",
      direction: "SHORT",
      confidence: 0.8,
      pattern: "BOS",
      reason: "BOS downside"
    };
  }
  return null;
}

function detectCHoCH(candles, structure) {
  if (candles.length < 10 || !structure) return null;
  var last = candles[candles.length - 1];
  var prevCandles = candles.slice(-10, -1);
  var prevLow = Math.min.apply(null, prevCandles.map(function(c) { return c.low; }));
  var prevHigh = Math.max.apply(null, prevCandles.map(function(c) { return c.high; }));

  if (structure === "HH" && last.close < prevLow) {
    return {
      type: "CHOCH",
      status: "ENTRY",
      direction: "SHORT",
      confidence: 0.75,
      pattern: "CHOCH",
      reason: "structure flip HH -> bear"
    };
  }
  if (structure === "LL" && last.close > prevHigh) {
    return {
      type: "CHOCH",
      status: "ENTRY",
      direction: "LONG",
      confidence: 0.75,
      pattern: "CHOCH",
      reason: "structure flip LL -> bull"
    };
  }
  return null;
}

function getSMCEntry(smc) {
  var sweep = smc.sweep;
  var inducement = smc.inducement;
  var bos = smc.bos;
  var choch = smc.choch;

  // Priority: sweep+choch > sweep+bos > inducement+sweep > single
  if (sweep && choch && sweep.direction === choch.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry || sweep.price,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: sweep.rr || 1.5,
      confidence: 0.95,
      source: "SMC_ENGINE",
      reason: "sweep + choch confirmed",
      extra: { sweep: true, choch: true, patternType: "SMC_COMBO" }
    };
  }

  if (sweep && bos && sweep.direction === bos.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry || sweep.price,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: sweep.rr || 1.5,
      confidence: 0.9,
      source: "SMC_ENGINE",
      reason: "sweep + BOS confirmed",
      extra: { sweep: true, bos: true, patternType: "SMC_COMBO" }
    };
  }

  if (inducement && sweep && inducement.direction === sweep.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry || sweep.price,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: sweep.rr || 1.5,
      confidence: 0.88,
      source: "SMC_ENGINE",
      reason: "inducement + sweep confirmed",
      extra: { inducement: true, sweep: true, patternType: "SMC_COMBO" }
    };
  }

  if (bos && choch && bos.direction === choch.direction) {
    return {
      status: "ENTRY",
      direction: bos.direction,
      entry: bos.price || bos.entry,
      tp: bos.tp,
      sl: bos.sl,
      rr: 1.5,
      confidence: 0.85,
      source: "SMC_ENGINE",
      reason: "BOS + CHOCH confirmed",
      extra: { bos: true, choch: true, patternType: "SMC_COMBO" }
    };
  }

  return null;
}

// ══════════════════════════════════════════════════════════
// PATTERN DETECTION ENGINE (CLASSIC SMC PATTERNS)
// ══════════════════════════════════════════════════════════

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

  // BEARISH breakdown — price closes BELOW neckline
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

  // BULLISH breakout — price closes ABOVE neckline
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

// ══════════════════════════════════════════════════════════
// BUILD DECISION — MASTER FUNCTION
// ══════════════════════════════════════════════════════════

function buildDecision(opts) {
  var candles = opts.candles;
  var sniper = opts.sniper;
  var payload = opts.payload;
  var htfBias = opts.htfBias || "NEUTRAL";
  var structure = payload.structure || "NA";
  var range = payload.resistance - payload.support;

  if (!candles || candles.length < 20) {
    return { status: "WAIT", direction: "NEUTRAL", confidence: "LOW", source: "NONE", reason: "insufficient data" };
  }

  // ══════════════════════════════════════════════════════════
  // SMC ENGINE — PRIORITY 1 (KING)
  // ══════════════════════════════════════════════════════════
  var sweep = detectLiquiditySweep(candles);
  var inducement = detectInducement(candles);
  var bos = detectBOS(candles);
  var choch = detectCHoCH(candles, structure);

  var smcEntry = getSMCEntry({ sweep: sweep, inducement: inducement, bos: bos, choch: choch });

  if (smcEntry && smcEntry.status === "ENTRY") {
    // HTF conflict check
    if (htfBias !== "NEUTRAL" && htfBias !== smcEntry.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "SMC_ENGINE",
        reason: "HTF conflict: " + smcEntry.direction + " vs HTF " + htfBias,
        extra: { htfConflict: true }
      };
    }

    // Sniper conflict check
    if (sniper && sniper.preferred && sniper.preferred !== smcEntry.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "SMC_ENGINE",
        reason: "sniper conflict: " + smcEntry.direction + " vs " + sniper.preferred,
        extra: { conflict: true }
      };
    }

    // SMART ENTRY MODE: use SAFE confirmation for SMC
    var confirmed = isConfirmationCandle(candles, smcEntry.direction);
    return {
      status: confirmed ? "ENTRY" : "PLAN",
      direction: smcEntry.direction,
      entry: smcEntry.entry,
      tp: smcEntry.tp,
      sl: smcEntry.sl,
      rr: smcEntry.rr,
      confidence: confirmed ? "HIGH" : "MEDIUM",
      source: "SMC_ENGINE",
      reason: smcEntry.reason,
      extra: smcEntry.extra || {}
    };
  }

  // ══════════════════════════════════════════════════════════
  // PATTERN ENGINE — PRIORITY 2 (CLASSIC PATTERNS)
  // ══════════════════════════════════════════════════════════
  var patterns = [
    detectDoubleTopPro(candles),
    detectDoubleBottomPro(candles),
    detectTrianglePro(candles),
  ].filter(Boolean);

  var entryPatterns = patterns.filter(function(p) { return p.status === "ENTRY"; });
  var planPatterns = patterns.filter(function(p) { return p.status === "PLAN"; });

  if (entryPatterns.length > 0) {
    var best = entryPatterns.reduce(function(a, b) {
      var scoreA = (a.confidence || 0) + Math.min(1, (a.rr || 0) / 3);
      var scoreB = (b.confidence || 0) + Math.min(1, (b.rr || 0) / 3);
      return scoreA > scoreB ? a : b;
    });

    var confirmed = isConfirmationCandle(candles, best.direction);

    // HTF conflict check
    if (htfBias !== "NEUTRAL" && htfBias !== best.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "PATTERN",
        reason: "HTF conflict: " + best.direction + " vs HTF " + htfBias,
        extra: { neckline: best.neckline || null, patternType: best.pattern || best.type, htfConflict: true }
      };
    }

    // Sniper conflict check
    if (sniper && sniper.preferred && sniper.preferred !== best.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "PATTERN",
        reason: "conflict: " + best.direction + " pattern but sniper " + sniper.preferred,
        extra: { neckline: best.neckline || null, patternType: best.pattern || best.type, conflict: true }
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
  // SNIPER ENGINE — PRIORITY 3 (only if no SMC + no Pattern)
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
  // PATTERN PLAN — PRIORITY 4 (waiting for confirmation)
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