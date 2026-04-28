// ── Decision Engine (ELITE SMART MONEY BRAIN) — Single Source of Truth ───
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

var getPivots = null;
try {
  var pivotModule = require("./pivot.js");
  getPivots = pivotModule.getPivots;
} catch(e) {
  getPivots = function(data, left, right) {
    left = left || 3;
    right = right || 3;
    var pivots = [];
    var i;
    for (i = left; i < data.length - right; i++) {
      var slice = data.slice(i - left, i + right + 1);
      var isHigh = slice.every(function(c) { return data[i].high >= c.high; });
      var isLow = slice.every(function(c) { return data[i].low <= c.low; });
      if (isHigh) pivots.push({ type: "HIGH", price: data[i].high, index: i });
      if (isLow) pivots.push({ type: "LOW", price: data[i].low, index: i });
    }
    return pivots;
  };
}

function detectLiquiditySweep(candles) {
  if (candles.length < 3) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  if (!last || !prev || !prev2) return null;

  if (prev.high > prev2.high) {
    if (last.high > prev.high && last.close < prev.high && last.close < last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        status: "ACTIVE",
        direction: "SHORT",
        entry: round(last.close, 2),
        tp: round(last.close - (prev.high - prev.low) * 0.5, 2),
        sl: round(last.high * 1.001, 2),
        rr: 1.5,
        confidence: 0.3,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep short"
      };
    }
  }

  if (prev.low < prev2.low) {
    if (last.low < prev.low && last.close > prev.low && last.close > last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        status: "ACTIVE",
        direction: "LONG",
        entry: round(last.close, 2),
        tp: round(last.close + (prev.high - prev.low) * 0.5, 2),
        sl: round(last.low * 0.999, 2),
        rr: 1.5,
        confidence: 0.3,
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

  if (last.high > prev.high && last.close < prev.close && last.close < last.open) {
    return {
      type: "INDUCEMENT_SHORT",
      status: "ACTIVE",
      direction: "SHORT",
      confidence: 0.2,
      pattern: "INDUCEMENT",
      reason: "inducement short"
    };
  }

  if (last.low < prev.low && last.close > prev.close && last.close > last.open) {
    return {
      type: "INDUCEMENT_LONG",
      status: "ACTIVE",
      direction: "LONG",
      confidence: 0.2,
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
    var range = prevHigh - prevLow;
    return {
      type: "BOS",
      status: "ACTIVE",
      direction: "LONG",
      entry: round(last.close, 2),
      tp: round(last.close + range * 0.6, 2),
      sl: round(prevLow, 2),
      rr: 1.5,
      confidence: 0.2,
      pattern: "BOS",
      reason: "BOS upside"
    };
  }
  if (last.close < prevLow) {
    var range = prevHigh - prevLow;
    return {
      type: "BOS",
      status: "ACTIVE",
      direction: "SHORT",
      entry: round(last.close, 2),
      tp: round(last.close - range * 0.6, 2),
      sl: round(prevHigh, 2),
      rr: 1.5,
      confidence: 0.2,
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
    var range = prevHigh - prevLow;
    return {
      type: "CHOCH",
      status: "ACTIVE",
      direction: "SHORT",
      entry: round(last.close, 2),
      tp: round(last.close - range * 0.6, 2),
      sl: round(prevHigh, 2),
      rr: 1.5,
      confidence: 0.3,
      pattern: "CHOCH",
      reason: "structure flip HH -> bear"
    };
  }
  if (structure === "LL" && last.close > prevHigh) {
    var range = prevHigh - prevLow;
    return {
      type: "CHOCH",
      status: "ACTIVE",
      direction: "LONG",
      entry: round(last.close, 2),
      tp: round(last.close + range * 0.6, 2),
      sl: round(prevLow, 2),
      rr: 1.5,
      confidence: 0.3,
      pattern: "CHOCH",
      reason: "structure flip LL -> bull"
    };
  }
  return null;
}

function calcRR(entry, tp, sl) {
  if (!entry || !tp || !sl) return 1.5;
  var rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  return Math.round(rr * 100) / 100;
}

function getSMCEntry(smc) {
  var sweep = smc.sweep;
  var inducement = smc.inducement;
  var bos = smc.bos;
  var choch = smc.choch;

  var totalConfidence = Math.min(
    (sweep ? sweep.confidence : 0) +
    (choch ? choch.confidence : 0) +
    (bos ? bos.confidence : 0) +
    (inducement ? inducement.confidence : 0),
    1.0
  );

  if (sweep && choch && sweep.direction === choch.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "sweep + choch",
      smcComponents: { sweep: true, choch: true }
    };
  }

  if (sweep && bos && sweep.direction === bos.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "sweep + BOS",
      smcComponents: { sweep: true, bos: true }
    };
  }

  if (inducement && sweep && inducement.direction === sweep.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "inducement + sweep",
      smcComponents: { inducement: true, sweep: true }
    };
  }

  if (bos && choch && bos.direction === choch.direction) {
    return {
      status: "ENTRY",
      direction: bos.direction,
      entry: bos.entry,
      tp: bos.tp,
      sl: bos.sl,
      rr: calcRR(bos.entry, bos.tp, bos.sl),
      confidence: totalConfidence,
      reason: "BOS + CHOCH",
      smcComponents: { bos: true, choch: true }
    };
  }

  if (sweep && sweep.entry && sweep.tp && sweep.sl) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "single sweep",
      smcComponents: { sweep: true }
    };
  }

  if (bos && bos.entry && bos.tp && bos.sl) {
    return {
      status: "ENTRY",
      direction: bos.direction,
      entry: bos.entry,
      tp: bos.tp,
      sl: bos.sl,
      rr: calcRR(bos.entry, bos.tp, bos.sl),
      confidence: totalConfidence,
      reason: "single BOS",
      smcComponents: { bos: true }
    };
  }

  if (choch && choch.entry && choch.tp && choch.sl) {
    return {
      status: "ENTRY",
      direction: choch.direction,
      entry: choch.entry,
      tp: choch.tp,
      sl: choch.sl,
      rr: calcRR(choch.entry, choch.tp, choch.sl),
      confidence: totalConfidence,
      reason: "single CHOCH",
      smcComponents: { choch: true }
    };
  }

  return null;
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
  var breakConfirmed = last.close < neckline.price;
  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close >= neckline.price - retestZone && last.close <= neckline.price + retestZone;
  var hadPullback = prev && breakConfirmed && (prev.high >= neckline.price && prev.close < neckline.price || atNeckline);

  if (!breakConfirmed) {
    return { type: "DOUBLE_TOP", status: "CLUE", direction: "SHORT", neckline: neckline.price, confidence: 0.2, reason: "double top clue — waiting break" };
  }
  if (!hadPullback && !atNeckline) {
    return { type: "DOUBLE_TOP", status: "CLUE", direction: "SHORT", neckline: neckline.price, confidence: 0.25, reason: "double top — waiting retest" };
  }

  return {
    type: "DOUBLE_TOP", status: "CLUE", direction: "SHORT",
    neckline: neckline.price, entry: round(last.close, 2),
    tp: round(last.close - (h2.price - neckline.price), 2),
    sl: round(h2.price * 1.0007, 2),
    rr: 1.5,
    confidence: 0.3, pattern: "DOUBLE_TOP", reason: "double top pattern clue"
  };
}

function detectDoubleBottomPro(candles) {
  var pivots = getPivots(candles);
  var lows = pivots.filter(function(p) { return p.type === "LOW"; });
  if (lows.length < 2) return null;

  var l1 = lows[lows.length - 2];
  var l2 = lows[lows.length - 2];
  var tolerance = l2.price * 0.003;
  if (Math.abs(l1.price - l2.price) > tolerance) return null;

  var necklineCand = pivots.filter(function(p) {
    return p.type === "HIGH" && p.index > l1.index && p.index < l2.index;
  });
  if (!necklineCand.length) return null;
  var neckline = necklineCand.reduce(function(a, b) { return a.price > b.price ? a : b; });

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var breakConfirmed = last.close > neckline.price;
  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close >= neckline.price - retestZone && last.close <= neckline.price + retestZone;
  var hadPullback = prev && breakConfirmed && (prev.low <= neckline.price && prev.close > neckline.price || atNeckline);

  if (!breakConfirmed) {
    return { type: "DOUBLE_BOTTOM", status: "CLUE", direction: "LONG", neckline: neckline.price, confidence: 0.2, reason: "double bottom clue — waiting break" };
  }
  if (!hadPullback && !atNeckline) {
    return { type: "DOUBLE_BOTTOM", status: "CLUE", direction: "LONG", neckline: neckline.price, confidence: 0.25, reason: "double bottom — waiting retest" };
  }

  return {
    type: "DOUBLE_BOTTOM", status: "CLUE", direction: "LONG",
    neckline: neckline.price, entry: round(last.close, 2),
    tp: round(last.close + (neckline.price - l2.price), 2),
    sl: round(l2.price * 0.9993, 2),
    rr: 1.5,
    confidence: 0.3, pattern: "DOUBLE_BOTTOM", reason: "double bottom pattern clue"
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
      return { type: "TRIANGLE", status: "CLUE", direction: "NEUTRAL", confidence: 0.15, reason: "fake breakout — rejected" };
    }
    return { type: "TRIANGLE", status: "CLUE", direction: "LONG", confidence: 0.25, pattern: "TRIANGLE", reason: "triangle upside clue" };
  }
  if (last.close < lower) {
    if (prev && last.low < lower && last.close > lower) {
      return { type: "TRIANGLE", status: "CLUE", direction: "NEUTRAL", confidence: 0.15, reason: "fake breakdown — rejected" };
    }
    return { type: "TRIANGLE", status: "CLUE", direction: "SHORT", confidence: 0.25, pattern: "TRIANGLE", reason: "triangle downside clue" };
  }

  return { type: "TRIANGLE", status: "CLUE", direction: "NEUTRAL", confidence: 0.2, reason: "triangle clue — waiting breakout" };
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
  var structure = payload.structure || "NA";

  if (!candles || candles.length < 20) {
    return { status: "WAIT", direction: "NEUTRAL", confidence: "LOW", source: "NONE", reason: "insufficient data" };
  }

  var sweep = detectLiquiditySweep(candles);
  var inducement = detectInducement(candles);
  var bos = detectBOS(candles);
  var choch = detectCHoCH(candles, structure);

  // Chop filter: no clear structure
  if (!sweep && !bos && !choch) {
    return {
      status: "WAIT",
      direction: "NEUTRAL",
      confidence: "LOW",
      source: "SMC_ENGINE",
      reason: "no clear structure — waiting for sweep/BOS/CHOCH"
    };
  }

  var smcEntry = getSMCEntry({ sweep: sweep, inducement: inducement, bos: bos, choch: choch });

  if (smcEntry && smcEntry.status === "ENTRY") {
    if (!smcEntry.entry || !smcEntry.tp || !smcEntry.sl) {
      return {
        status: "WAIT",
        direction: smcEntry.direction || "NEUTRAL",
        confidence: "LOW",
        source: "SMC_ENGINE",
        reason: "SMC detected but missing valid entry/tp/sl — waiting"
      };
    }

    if (htfBias !== "NEUTRAL" && htfBias !== smcEntry.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "SMC_ENGINE",
        reason: "HTF conflict: " + smcEntry.direction + " vs HTF " + htfBias,
        extra: { htfConflict: true, smcComponents: smcEntry.smcComponents }
      };
    }

    if (sniper && sniper.preferred && sniper.preferred !== smcEntry.direction) {
      return {
        status: "WAIT",
        direction: "NEUTRAL",
        confidence: "LOW",
        source: "SMC_ENGINE",
        reason: "sniper conflict: " + smcEntry.direction + " vs " + sniper.preferred,
        extra: { conflict: true, smcComponents: smcEntry.smcComponents }
      };
    }

    var finalConfidence = smcEntry.confidence;
    var finalReason = smcEntry.reason;

    var patterns = [
      detectDoubleTopPro(candles),
      detectDoubleBottomPro(candles),
      detectTrianglePro(candles),
    ].filter(Boolean);

    var patternClue = patterns.length > 0 ? patterns[0] : null;

    if (patternClue && patternClue.direction === smcEntry.direction) {
      finalConfidence = Math.min(1, finalConfidence + 0.1);
      finalReason += " + " + (patternClue.pattern || patternClue.type) + " confluence";
    }

    var confirmed = isConfirmationCandle(candles, smcEntry.direction);

    return {
      status: confirmed ? "ENTRY" : "PLAN",
      direction: smcEntry.direction,
      entry: smcEntry.entry,
      tp: smcEntry.tp,
      sl: smcEntry.sl,
      rr: smcEntry.rr,
      confidence: confirmed ? "HIGH" : "MEDIUM",
      source: "ELITE_SMC",
      reason: finalReason,
      extra: {
        smcComponents: smcEntry.smcComponents,
        patternBoost: patternClue && patternClue.direction === smcEntry.direction ? (patternClue.pattern || patternClue.type) : null
      }
    };
  }

  var allPatterns = [
    detectDoubleTopPro(candles),
    detectDoubleBottomPro(candles),
    detectTrianglePro(candles),
  ].filter(Boolean);

  if (allPatterns.length > 0) {
    var clue = allPatterns[0];
    return {
      status: "WAIT",
      direction: clue.direction || "NEUTRAL",
      confidence: "LOW",
      source: "PATTERN",
      reason: clue.reason + " — waiting SMC confirmation (no entry without SMC)",
      extra: {
        patternType: clue.pattern || clue.type,
        neckline: clue.neckline || null,
        clueOnly: true
      }
    };
  }

  return {
    status: "WAIT",
    direction: "NEUTRAL",
    confidence: "LOW",
    source: "NONE",
    reason: "no SMC signal — waiting smart money entry"
  };
}

module.exports = { buildDecision: buildDecision };