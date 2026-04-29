// ── Decision Engine (ELITE SMART MONEY BRAIN) — Single Source of Truth ───
// Modules: smc, ob, fvg, htf — unified into one decision brain
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

// ── Import SMC engine ────────────────────────────────────────────
var smc;
try { smc = require("./smc"); } catch(e) {
  // inline fallback
  smc = {
    detectLiquiditySweep: function(){return null;},
    detectInducement: function(){return null;},
    detectBOS: function(){return null;},
    detectCHoCH: function(){return null;},
    getSMCEntry: function(){return null;}
  };
}

// ── Import OB engine ────────────────────────────────────────────
var ob;
try { ob = require("./ob"); } catch(e) {
  ob = { detectOrderBlock: function(){return null;} };
}

// ── Import FVG engine ───────────────────────────────────────────
var fvg;
try { fvg = require("./fvg"); } catch(e) {
  fvg = { detectFVG: function(){return null;} };
}

// ── Import HTF engine ───────────────────────────────────────────
var htf;
try { htf = require("./htf"); } catch(e) {
  htf = { getHTFBias: function(){ return "NEUTRAL"; }, getStructure: function(){ return "NA"; } };
}

var multiSignal;
try { multiSignal = require("./multiSignal"); } catch(e) {
  multiSignal = { generateMultiSignals: function(){ return []; } };
}

var lifecycle;
try { lifecycle = require("./signalLifecycle"); } catch(e) {
  lifecycle = { addSignals: function(){ return []; }, updateLifecycle: function(s){ return s; } };
}

var LAST_MULTI_SIGNALS = [];

// ── Pivot helper ────────────────────────────────────────────────
var getPivots = null;
try {
  var pivotMod = require("./pivot.js");
  getPivots = pivotMod.getPivots;
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

// ══════════════════════════════════════════════════════════
// PATTERN ENGINE — Confidence Booster Only (NOT a Decision)
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
  var breakConfirmed = last.close < neckline.price;
  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close >= neckline.price - retestZone && last.close <= neckline.price + retestZone;
  var hadPullback = prev && breakConfirmed && (prev.high >= neckline.price && prev.close < neckline.price || atNeckline);

  if (!breakConfirmed) {
    return { type: "DOUBLE_TOP", status: "CLUE", direction: "SHORT", neckline: neckline.price, confidence: 0.15, reason: "double top clue — waiting break" };
  }
  if (!hadPullback && !atNeckline) {
    return { type: "DOUBLE_TOP", status: "CLUE", direction: "SHORT", neckline: neckline.price, confidence: 0.2, reason: "double top — waiting retest" };
  }

  return {
    type: "DOUBLE_TOP", status: "CLUE", direction: "SHORT",
    neckline: neckline.price, entry: round(last.close, 2),
    tp: round(last.close - (h2.price - neckline.price), 2),
    sl: round(h2.price * 1.0007, 2),
    rr: 1.5,
    confidence: 0.25, pattern: "DOUBLE_TOP", reason: "double top pattern clue"
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
  var breakConfirmed = last.close > neckline.price;
  var retestZone = neckline.price * 0.001;
  var atNeckline = last.close >= neckline.price - retestZone && last.close <= neckline.price + retestZone;
  var hadPullback = prev && breakConfirmed && (prev.low <= neckline.price && prev.close > neckline.price || atNeckline);

  if (!breakConfirmed) {
    return { type: "DOUBLE_BOTTOM", status: "CLUE", direction: "LONG", neckline: neckline.price, confidence: 0.15, reason: "double bottom clue — waiting break" };
  }
  if (!hadPullback && !atNeckline) {
    return { type: "DOUBLE_BOTTOM", status: "CLUE", direction: "LONG", neckline: neckline.price, confidence: 0.2, reason: "double bottom — waiting retest" };
  }

  return {
    type: "DOUBLE_BOTTOM", status: "CLUE", direction: "LONG",
    neckline: neckline.price, entry: round(last.close, 2),
    tp: round(last.close + (neckline.price - l2.price), 2),
    sl: round(l2.price * 0.9993, 2),
    rr: 1.5,
    confidence: 0.25, pattern: "DOUBLE_BOTTOM", reason: "double bottom pattern clue"
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
      return { type: "TRIANGLE", status: "CLUE", direction: "NEUTRAL", confidence: 0.1, reason: "fake breakout — rejected" };
    }
    return { type: "TRIANGLE", status: "CLUE", direction: "LONG", confidence: 0.2, pattern: "TRIANGLE", reason: "triangle upside clue" };
  }
  if (last.close < lower) {
    if (prev && last.low < lower && last.close > lower) {
      return { type: "TRIANGLE", status: "CLUE", direction: "NEUTRAL", confidence: 0.1, reason: "fake breakdown — rejected" };
    }
    return { type: "TRIANGLE", status: "CLUE", direction: "SHORT", confidence: 0.2, pattern: "TRIANGLE", reason: "triangle downside clue" };
  }

  return { type: "TRIANGLE", status: "CLUE", direction: "NEUTRAL", confidence: 0.15, reason: "triangle clue — waiting breakout" };
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
// BUILD DECISION — ELITE BRAIN
// Priority: SMC > OB > FVG > PatternBoost > Wait
// ══════════════════════════════════════════════════════════

function buildDecision(opts) {
  var candles = opts.candles;
  var sniper = opts.sniper;
  var payload = opts.payload;
  var htfBias = opts.htfBias || "NEUTRAL";
  var htfCandles = opts.htfCandles || null;

  if (!candles || candles.length < 20) {
    return { status: "WAIT", direction: "NEUTRAL", confidence: "LOW", source: "NONE", reason: "insufficient data" };
  }

  // ── HTF bias from HTF engine ───────────────────────────────────
  var htfBiasActual = htfBias;
  if (htfCandles && htfCandles.length >= 50) {
    htfBiasActual = htf.getHTFBias(htfCandles);
  }

  // ── SMC Engine ───────────────────────────────────────────────
  var structure = payload.structure || htf.getStructure(candles);
  var sweep = smc.detectLiquiditySweep(candles);
  var inducement = smc.detectInducement(candles);
  var bos = smc.detectBOS(candles);
  var choch = smc.detectCHoCH(candles, structure);

  // Chop filter: no clear structure = wait
  if (!sweep && !bos && !choch) {
    var fallback = [{
      name: "ENGINE",
      type: "WAIT",
      entry: payload.close,
      tp: [payload.close],
      sl: payload.close,
      status: "WAIT",
      reason: "no clear SMC structure",
      score: 0,
      confidence: "LOW"
    }];
    return {
      status: "WAIT",
      direction: "NEUTRAL",
      confidence: "LOW",
      source: "ELITE_ENGINE",
      reason: "no clear SMC structure — waiting for sweep/BOS/CHOCH",
      multi_signals: fallback
    };
  }

  var smcEntry = smc.getSMCEntry({ sweep: sweep, inducement: inducement, bos: bos, choch: choch });

  if (!smcEntry || !smcEntry.entry || !smcEntry.tp || !smcEntry.sl) {
    var fallback2 = [{
      name: "ENGINE",
      type: "WAIT",
      entry: payload.close,
      tp: [payload.close],
      sl: payload.close,
      status: "WAIT",
      reason: "SMC detected but missing valid entry/tp/sl",
      score: 0,
      confidence: "LOW"
    }];
    return {
      status: "WAIT",
      direction: "NEUTRAL",
      confidence: "LOW",
      source: "ELITE_ENGINE",
      reason: "SMC detected but missing valid entry/tp/sl — waiting",
      multi_signals: fallback2
    };
  }

  // ── OB + FVG Detection ────────────────────────────────────────
  var obDetected = ob.detectOrderBlock(candles);
  var fvgDetected = fvg.detectFVG(candles);

  // ── Build context signals early (used in all return paths) ─
  var smcSignal = smcEntry ? { direction: smcEntry.direction, entry: smcEntry.entry, tp: smcEntry.tp, sl: smcEntry.sl, reason: smcEntry.reason } : null;
  var obSignal = obDetected ? { direction: obDetected.direction, zone: obDetected.zone, entry: obDetected.entry, tp: obDetected.tp, sl: obDetected.sl } : null;
  var fvgSignal = fvgDetected ? { direction: fvgDetected.direction, zone: fvgDetected.zone, reason: fvgDetected.reason } : null;
  var emaAlign = payload.close > payload.ema20 && payload.ema20 > payload.ema50
    ? "LONG"
    : payload.close < payload.ema20 && payload.ema20 < payload.ema50
    ? "SHORT"
    : "NEUTRAL";
  var context = {
    htf_bias: htfBiasActual, structure: structure, rsi: payload.rsi,
    ema_align: emaAlign, smc: smcSignal, ob: obSignal, fvg: fvgSignal
  };

  // ── Elite Decision: SMC + OB + FVG + HTF Confluence ─────────────
  var baseConfidence = smcEntry.confidence;
  var confluenceReasons = [];

  // OB boost
  if (obDetected && obDetected.direction === smcEntry.direction) {
    baseConfidence = Math.min(1, baseConfidence + 0.2);
    confluenceReasons.push("OB");
  }

  // FVG boost
  if (fvgDetected && fvgDetected.direction === smcEntry.direction) {
    baseConfidence = Math.min(1, baseConfidence + 0.1);
    confluenceReasons.push("FVG");
  }

  // Pattern boost
  var patterns = [
    detectDoubleTopPro(candles),
    detectDoubleBottomPro(candles),
    detectTrianglePro(candles),
  ].filter(Boolean);
  var patternClue = patterns.length > 0 ? patterns[0] : null;

  if (patternClue && patternClue.direction === smcEntry.direction) {
    baseConfidence = Math.min(1, baseConfidence + 0.05);
    confluenceReasons.push(patternClue.pattern || patternClue.type);
  }

  // HTF conflict check — reject counter-trend
  if (htfBiasActual !== "NEUTRAL" && htfBiasActual !== smcEntry.direction) {
    var htfFallback = [{
      name: "ENGINE",
      type: "WAIT",
      entry: payload.close,
      tp: [payload.close],
      sl: payload.close,
      status: "WAIT",
      reason: "HTF conflict: " + smcEntry.direction + " vs HTF " + htfBiasActual,
      score: 0,
      confidence: "LOW"
    }];
    return {
      status: "WAIT",
      direction: "NEUTRAL",
      confidence: "LOW",
      source: "ELITE_ENGINE",
      reason: "HTF conflict: " + smcEntry.direction + " vs HTF " + htfBiasActual,
      extra: {
        htfConflict: true,
        smcComponents: smcEntry.smcComponents,
        htfBias: htfBiasActual
      },
      multi_signals: htfFallback
    };
  }

  // Sniper conflict check
  if (sniper && sniper.preferred && sniper.preferred !== smcEntry.direction) {
    var snFallback = [{
      name: "ENGINE",
      type: "WAIT",
      entry: payload.close,
      tp: [payload.close],
      sl: payload.close,
      status: "WAIT",
      reason: "sniper conflict: " + smcEntry.direction + " vs " + sniper.preferred,
      score: 0,
      confidence: "LOW"
    }];
    return {
      status: "WAIT",
      direction: "NEUTRAL",
      confidence: "LOW",
      source: "ELITE_ENGINE",
      reason: "sniper conflict: " + smcEntry.direction + " vs " + sniper.preferred,
      extra: { conflict: true, smcComponents: smcEntry.smcComponents },
      multi_signals: snFallback
    };
  }

  // Confirmation candle (SAFE mode)
  var confirmed = isConfirmationCandle(candles, smcEntry.direction);

  var reasonText = smcEntry.reason;
  if (confluenceReasons.length > 0) {
    reasonText += " + " + confluenceReasons.join(" + ");
  }

  var result = {
    status: confirmed ? "ENTRY" : "PLAN",
    direction: smcEntry.direction,
    entry: smcEntry.entry,
    tp: smcEntry.tp,
    sl: smcEntry.sl,
    rr: smcEntry.rr,
    confidence: confirmed ? "HIGH" : "MEDIUM",
    source: "ELITE_SMC",
    reason: reasonText,
    extra: {
      smcComponents: smcEntry.smcComponents,
      ob: obDetected ? { direction: obDetected.direction, zone: obDetected.zone } : null,
      fvg: fvgDetected ? { direction: fvgDetected.direction, zone: fvgDetected.zone } : null,
      htfBias: htfBiasActual,
      patternBoost: patternClue && patternClue.direction === smcEntry.direction ? (patternClue.pattern || patternClue.type) : null,
      confluence: {
        smc: true,
        ob: !!obDetected && obDetected.direction === smcEntry.direction,
        fvg: !!fvgDetected && fvgDetected.direction === smcEntry.direction,
        pattern: !!patternClue && patternClue.direction === smcEntry.direction
      }
    }
  };

  result.multi_signals = multiSignal.generateMultiSignals(payload, result, context);

  console.log("SMC:", context.smc);
  console.log("OB:", context.ob);
  console.log("FVG:", context.fvg);
  console.log("MULTI RAW:", result.multi_signals ? result.multi_signals.length : 0);

  if (!result.multi_signals || result.multi_signals.length === 0) {
    console.log("⚠️ FORCE FALLBACK SIGNAL");
    result.multi_signals = multiSignal.generateFallbackSignals(payload);
  }

  var bestSignals = pickBestLongShort(result.multi_signals);
  result.multi_signals = bestSignals;

  console.log("🔥 BEST 2 SIGNAL:", bestSignals.length);

  if (result.multi_signals.length > 0) {
    result.multi_signals = result.multi_signals.map(function(sig) {
      var tag = sig.type === "LONG" ? "BEST LONG" : "BEST SHORT";
      return { ...sig, tag: tag };
    });
  }

  // ── FORCE DIRECTION FIX ─────────────────────────────────
  if (!result.direction || result.direction === "NEUTRAL" || result.status === "WAIT") {
    var assigned = false;
    var fallbackReason = "";

    if (context.htf_bias === "LONG") {
      result.direction = "LONG";
      fallbackReason = "fallback HTF bias LONG";
      assigned = true;
    } else if (context.htf_bias === "SHORT") {
      result.direction = "SHORT";
      fallbackReason = "fallback HTF bias SHORT";
      assigned = true;
    } else if (payload.ema20 && payload.ema50) {
      if (payload.ema20 > payload.ema50) {
        result.direction = "LONG";
        fallbackReason = "fallback EMA trend LONG";
        assigned = true;
      } else {
        result.direction = "SHORT";
        fallbackReason = "fallback EMA trend SHORT";
        assigned = true;
      }
    } else {
      if (payload.close > payload.open) {
        result.direction = "LONG";
        fallbackReason = "fallback bullish candle";
        assigned = true;
      } else {
        result.direction = "SHORT";
        fallbackReason = "fallback bearish candle";
        assigned = true;
      }
    }

    if (assigned) {
      result.status = "PLAN";
      result.reason = fallbackReason;
      result.source = "FALLBACK MODE";
      if (!result.entry) result.entry = payload.close;
      if (!result.tp) result.tp = result.direction === "LONG" ? payload.close + 150 : payload.close - 150;
      if (!result.sl) result.sl = result.direction === "LONG" ? payload.close - 100 : payload.close + 100;
      if (!result.rr) result.rr = 1.5;
      console.log("🔥 FORCE DIRECTION:", result.direction, fallbackReason);
    }
  }

  if (result.multi_signals && result.multi_signals.length > 0) {
    lifecycle.addSignals(result.multi_signals);
  }

  var lifecycleSignals = lifecycle.updateLifecycle(payload.close);
  result.lifecycle_signals = lifecycleSignals.slice(-5);

  return result;
}

function pickBestLongShort(signals) {
  if (!signals || !signals.length) return [];

  var bestLong = null;
  var bestShort = null;

  signals.forEach(function(s) {
    if (!s.score) return;

    if (s.type === "LONG") {
      if (!bestLong || s.score > bestLong.score) {
        bestLong = s;
      }
    }

    if (s.type === "SHORT") {
      if (!bestShort || s.score > bestShort.score) {
        bestShort = s;
      }
    }
  });

  var result = [];
  if (bestLong) result.push(bestLong);
  if (bestShort) result.push(bestShort);

  return result;
}

module.exports = { buildDecision: buildDecision };