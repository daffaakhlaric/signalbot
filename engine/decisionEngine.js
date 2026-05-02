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
// SNIPER SUPER — Elite Momentum Entry System

function detectSniperSuper(context, candles) {
  var closedCandle = candles[candles.length - 2];
  var lastCandle = candles[candles.length - 1];

  if (!closedCandle || !lastCandle) return null;

  var range = closedCandle.high - closedCandle.low;
  var body = Math.abs(closedCandle.close - closedCandle.open);
  var bodyPct = range > 0 ? body / range : 0;

  if (bodyPct < 0.05) return null;

  var price = context.close || closedCandle.close;
  var ob = context.ob;
  var htf_bias = context.htf_bias;

  // Fallback if NEUTRAL — use structure or EMA or candle direction
  if (!htf_bias) htf_bias = "LONG";

  if (htf_bias === "NEUTRAL" || !htf_bias) {
    if (context.structure === "HH" || context.structure === "HL") {
      htf_bias = "LONG";
    } else if (context.structure === "LL" || context.structure === "LH") {
      htf_bias = "SHORT";
    } else if (context.ema20 && context.ema50) {
      htf_bias = context.close > context.ema20 ? "LONG" : "SHORT";
    } else {
      // Last resort: use candle direction
      htf_bias = closedCandle.close > closedCandle.open ? "LONG" : "SHORT";
    }
  }

  if (htf_bias === "LONG") {
    return {
      name: "SNIPER SUPER",
      type: "LONG",
      entry: ob?.entry || ob?.zone?.[0] || price,
      tp: ob?.tp || price + 150,
      sl: ob?.sl || price - 100,
      status: "ACTIVE",
      reason: "HTF bias + impulse",
      score_boost: 30
    };
  }

  if (htf_bias === "SHORT") {
    return {
      name: "SNIPER SUPER",
      type: "SHORT",
      entry: ob?.entry || ob?.zone?.[1] || price,
      tp: ob?.tp || price - 150,
      sl: ob?.sl || price + 100,
      status: "ACTIVE",
      reason: "HTF bias + impulse",
      score_boost: 30
    };
  }

  return null;
}

function pickBestSignal(signals, context) {
  if (!signals || signals.length === 0) return null;
  var scoring = require("./aiScoring");
  var scored = signals.map(function(s) {
    var res = scoring.scoreSignal(s, context);
    return { ...s, score: res.score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  var best = scored[0];
  return best || signals[0];
}

// ── RSI (lightweight, no external lib) ────────────────────
function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  var gains = 0, losses = 0;
  for (var i = closes.length - period; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  var rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

// ── OB Proximity Check ───────────────────────────────────
function isNearOB(price, ob) {
  if (!ob || !ob.zone) return false;
  var zone = Array.isArray(ob.zone) ? ob.zone : [ob.zone, ob.zone];
  var low = zone[0], high = zone[1];
  var buffer = (high - low) * 0.5;
  return price >= (low - buffer) && price <= (high + buffer);
}

// ── Market Mode Detection (TRENDING vs SIDEWAYS) ───────────
function detectMarketMode(context, candles) {
  if (!candles || candles.length < 20) return "SIDEWAYS";
  var closes = candles.map(function(c) { return c.close; });
  var ema20 = context.ema20;
  var ema50 = context.ema50;
  var last = closes[closes.length - 1];
  var prev = closes[closes.length - 10];
  var move = Math.abs(last - prev);
  var range = Math.max.apply(null, closes.slice(-20)) - Math.min.apply(null, closes.slice(-20));

  if (
    context.structure === "HH" || context.structure === "LL" ||
    (ema20 && ema50 && Math.abs(ema20 - ema50) > 50) ||
    (range > 0 && move > range * 0.5)
  ) {
    return "TRENDING";
  }
  return "SIDEWAYS";
}

// ── LTF Sniper (ultra-fast entry using 1m) ────────────────
function detectLTFSignal(htfContext, ltfCandles) {
  var last = ltfCandles[ltfCandles.length - 1];
  var prev = ltfCandles[ltfCandles.length - 2];
  if (!last || !prev) return null;

  var range = last.high - last.low;
  var body = Math.abs(last.close - last.open);
  var bodyPct = range > 0 ? body / range : 0;
  if (bodyPct < 0.4) return null;

  var closes = ltfCandles.map(function(c) { return c.close; });
  var rsi = calcRSI(closes);

  if (htfContext.htf_bias === "LONG" && last.close > prev.high && rsi < 65) {
    return {
      name: "LTF SNIPER",
      type: "LONG",
      entry: last.close,
      tp: last.close + 150,
      sl: last.low,
      status: "ACTIVE",
      reason: "HTF LONG + LTF breakout + RSI " + Math.round(rsi)
    };
  }

  if (htfContext.htf_bias === "SHORT" && last.close < prev.low && rsi > 35) {
    return {
      name: "LTF SNIPER",
      type: "SHORT",
      entry: last.close,
      tp: last.close - 150,
      sl: last.high,
      status: "ACTIVE",
      reason: "HTF SHORT + LTF breakdown + RSI " + Math.round(rsi)
    };
  }

  return null;
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

function detectEngulfing(candles) {
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  var lastBody = Math.abs(last.close - last.open);
  var prevBody = Math.abs(prev.close - prev.open);
  if (lastBody <= 0 || prevBody <= 0) return null;

  var prevGreen = prev.close > prev.open;
  var lastRed = last.close < last.open;
  var lastGreen = last.close > last.open;
  var prevRed = prev.close < prev.open;

  if (prevGreen && lastRed && last.close < prev.open && last.open > prev.close) {
    var engulfPct = lastBody / prevBody;
    if (engulfPct >= 1.0) {
      return {
        name: "ENGULFING",
        type: "SHORT",
        entry: last.close,
        tp: last.close - lastBody * 2,
        sl: last.high,
        status: "ACTIVE",
        reason: "bearish engulfing — seller takeover",
        score: 25,
        confidence: 0.7
      };
    }
  }

  if (prevRed && lastGreen && last.close > prev.open && last.open < prev.close) {
    var engulfPct = lastBody / prevBody;
    if (engulfPct >= 1.0) {
      return {
        name: "ENGULFING",
        type: "LONG",
        entry: last.close,
        tp: last.close + lastBody * 2,
        sl: last.low,
        status: "ACTIVE",
        reason: "bullish engulfing — buyer takeover",
        score: 25,
        confidence: 0.7
      };
    }
  }

  return null;
}

function detectWickRejection(candles) {
  var last = candles[candles.length - 1];
  if (!last) return null;

  var range = last.high - last.low;
  if (range <= 0) return null;

  var body = Math.abs(last.close - last.open);
  var bodyPct = body / range;
  var upperWick = last.high - Math.max(last.close, last.open);
  var lowerWick = Math.min(last.close, last.open) - last.low;
  var upperPct = upperWick / range;
  var lowerPct = lowerWick / range;

  if (upperPct > 0.6 && bodyPct < 0.35 && last.close < last.open) {
    return {
      name: "WICK_REJECT",
      type: "SHORT",
      entry: last.close,
      tp: last.close - body,
      sl: last.high,
      status: "ACTIVE",
      reason: "long upper wick rejection — seller takeover",
      score: 20,
      confidence: 0.6
    };
  }

  if (lowerPct > 0.6 && bodyPct < 0.35 && last.close > last.open) {
    return {
      name: "WICK_REJECT",
      type: "LONG",
      entry: last.close,
      tp: last.close + body,
      sl: last.low,
      status: "ACTIVE",
      reason: "long lower wick rejection — buyer takeover",
      score: 20,
      confidence: 0.6
    };
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
  var ltfCandles = opts.ltfCandles || null;

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
    ema_align: emaAlign, smc: smcSignal, ob: obSignal, fvg: fvgSignal,
    close: payload.close, ema20: payload.ema20, ema50: payload.ema50
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

  result.multi_signals = multiSignal.generateMultiSignals(payload, result, context, candles);

  var sniperSuper = detectSniperSuper(context, candles);
  var closedCandle = candles[candles.length - 2];
  var bodyPctCalc = closedCandle ? ((closedCandle.high - closedCandle.low) > 0 ? (Math.abs(closedCandle.close - closedCandle.open) / (closedCandle.high - closedCandle.low) * 100).toFixed(1) : 0) : 0;
  console.log("=== SNIPER DEBUG ===");
  console.log("HTF:", context.htf_bias, "| STRUCTURE:", context.structure, "| bodyPct:", bodyPctCalc + "%");
  console.log("SNIPER:", sniperSuper ? sniperSuper.name + " " + sniperSuper.type : null);
  console.log("MULTI before sniper:", result.multi_signals ? result.multi_signals.length : 0);
  if (sniperSuper) {
    result.multi_signals.push(sniperSuper);
  }
  console.log("MULTI after sniper:", result.multi_signals ? result.multi_signals.length : 0);

  // 🔥 FORCE SIGNAL (ANTI KOSONG)
  if (!result.multi_signals || result.multi_signals.length === 0) {
    result.multi_signals = [{
      name: "FORCED SIGNAL",
      type: context.htf_bias || "LONG",
      entry: context.close,
      tp: [context.close + 100],
      sl: context.close - 100,
      status: "ACTIVE",
      reason: "fallback signal (no setup)"
    }];
  }

  // ── LTF SNIPER (ultra-fast entry from 1m candle) ───────────
  if (ltfCandles && ltfCandles.length > 5) {
    var ltfSignal = detectLTFSignal(context, ltfCandles);
    if (ltfSignal) {
      result.multi_signals.push(ltfSignal);
    }
  }

  // ── MARKET MODE ADAPTIVE ─────────────────────────────────
  context.market_mode = detectMarketMode(context, candles);

  console.log("SMC:", context.smc);
  console.log("OB:", context.ob);
  console.log("FVG:", context.fvg);
  console.log("MODE:", context.market_mode);
  console.log("MULTI RAW:", result.multi_signals ? result.multi_signals.length : 0);

  // ── SIDEWAYS: keep only RANGE/SCALP signals ──────────────
  if (context.market_mode === "SIDEWAYS") {
    var allowedNames = ["RANGE LONG", "RANGE SHORT", "SCALP", "BREAKOUT LONG", "BREAKDOWN SHORT", "FORCED SIGNAL"];
    result.multi_signals = result.multi_signals.filter(function(s) {
      return allowedNames.indexOf(s.name) !== -1;
    });
    if (result.multi_signals.length === 0) {
      result.multi_signals = multiSignal.generateFallbackSignals(payload);
    }
  }

  // ── TRENDING: boost sniper signals ────────────────────────
  if (context.market_mode === "TRENDING") {
    var sniperSuper = detectSniperSuper(context, candles);
    if (sniperSuper) {
      result.multi_signals.push(sniperSuper);
    }
    result.multi_signals = result.multi_signals.map(function(s) {
      if (s.name === "SNIPER SUPER" || s.name === "LTF SNIPER") {
        s.score = (s.score || 30) + 30;
      }
      return s;
    });
  }

  if (!result.multi_signals || result.multi_signals.length === 0) {
    console.log("⚠️ FORCE FALLBACK SIGNAL");
    result.multi_signals = multiSignal.generateFallbackSignals(payload);
  }

  var bestSignals = pickBestLongShort(result.multi_signals);
  if (!bestSignals || bestSignals.length === 0) {
    bestSignals = result.multi_signals;
  }
  result.multi_signals = bestSignals;

  var bestSignal = pickBestSignal(result.multi_signals, context);

  if (!bestSignal) {
    bestSignal = {
      name: "FORCED SIGNAL",
      type: context.htf_bias || "LONG",
      entry: payload.close,
      tp: payload.close + (context.htf_bias === "SHORT" ? -100 : 100),
      sl: context.htf_bias === "SHORT" ? payload.close + 100 : payload.close - 100,
      status: "ACTIVE",
      reason: "always-on signal"
    };
  }

  result.best_signal = bestSignal;

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
  result.market_mode = context.market_mode || "SIDEWAYS";

  var engulf = detectEngulfing(candles);
  if (engulf) {
    result.multi_signals.push(engulf);
  }
  var wickReject = detectWickRejection(candles);
  if (wickReject) {
    result.multi_signals.push(wickReject);
  }

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