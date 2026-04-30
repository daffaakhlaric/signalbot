const { scoreSignal } = require("./aiScoring");

function getPriority(sig) {
  if (sig.name === "SNIPER SUPER") return 5;
  if (sig.name === "SMC") return 4;
  if (sig.name === "ORDER BLOCK") return 3;
  if (sig.name === "FVG") return 2;
  if (sig.name === "PRE SNIPER") return 3;
  return 1;
}

function generateFallbackSignals(payload) {
  var price = payload.close;
  var range = (payload.high - payload.low) || 300;

  return [
    {
      name: "RANGE SHORT",
      type: "SHORT",
      entry: price + range * 0.3,
      tp: [price - range * 0.3],
      sl: price + range * 0.6,
      status: "PLAN",
      reason: "range resistance play",
      score: 30,
      confidence: "LOW"
    },
    {
      name: "RANGE LONG",
      type: "LONG",
      entry: price - range * 0.3,
      tp: [price + range * 0.3],
      sl: price - range * 0.6,
      status: "PLAN",
      reason: "range support play",
      score: 30,
      confidence: "LOW"
    },
    {
      name: "BREAKOUT LONG",
      type: "LONG",
      entry: price + range * 0.5,
      tp: [price + range],
      sl: price + range * 0.2,
      status: "WAIT",
      reason: "breakout upside",
      score: 35,
      confidence: "MEDIUM"
    },
    {
      name: "BREAKDOWN SHORT",
      type: "SHORT",
      entry: price - range * 0.5,
      tp: [price - range],
      sl: price - range * 0.2,
      status: "WAIT",
      reason: "breakdown downside",
      score: 35,
      confidence: "MEDIUM"
    },
    {
      name: "SCALP",
      type: payload.close > payload.open ? "SHORT" : "LONG",
      entry: price,
      tp: [price + (payload.close > payload.open ? -100 : 100)],
      sl: price + (payload.close > payload.open ? 100 : -100),
      status: "WAIT",
      reason: "micro scalp",
      score: 25,
      confidence: "LOW"
    }
  ];
}

function generateMultiSignals(payload, signal, context) {
  var price = payload.close;
  var signals = [];

  // SMC
  if (context.smc && context.smc.direction) {
    signals.push({
      name: "SMC",
      type: context.smc.direction,
      entry: context.smc.entry || price,
      tp: [context.smc.tp],
      sl: context.smc.sl,
      status: "ACTIVE",
      reason: context.smc.reason
    });
  }

  // ORDER BLOCK
  if (context.ob && context.ob.zone) {
    signals.push({
      name: "ORDER BLOCK",
      type: context.ob.direction,
      entry: context.ob.entry || context.ob.zone,
      tp: [context.ob.tp],
      sl: context.ob.sl,
      status: "PLAN",
      reason: "OB zone reaction"
    });
  }

  // FVG
  if (context.fvg && context.fvg.zone) {
    var fvgEntry = Array.isArray(context.fvg.zone) ? context.fvg.zone[0] : context.fvg.zone;
    signals.push({
      name: "FVG",
      type: context.fvg.direction,
      entry: fvgEntry,
      tp: [price + (context.fvg.direction === "LONG" ? 200 : -200)],
      sl: context.fvg.direction === "LONG" ? fvgEntry - 50 : fvgEntry + 50,
      status: "WAIT",
      reason: context.fvg.reason
    });
  }

  // SNIPER
  if (signal && signal.sniperSignal && signal.sniperSignal.direction) {
    signals.push({
      name: "SNIPER",
      type: signal.sniperSignal.direction,
      entry: signal.sniperSignal.entry,
      tp: [signal.sniperSignal.tp],
      sl: signal.sniperSignal.sl,
      status: "ACTIVE",
      reason: signal.sniperSignal.reason
    });
  }

  // PRE SNIPER — early momentum entry before breakout
  if (context.htf_bias && context.htf_bias !== "NEUTRAL") {
    signals.push({
      name: "PRE SNIPER",
      type: context.htf_bias,
      entry: price,
      tp: [price + (context.htf_bias === "LONG" ? 200 : -200)],
      sl: context.htf_bias === "LONG" ? price - 100 : price + 100,
      status: "READY",
      reason: "pre momentum entry"
    });
  }

  // Fallback if not enough signals
  if (signals.length < 2) {
    var fallback = generateFallbackSignals(payload);
    signals = signals.concat(fallback);
  }

  // AI scoring
  signals = signals.map(function(sig) {
    var ai = scoreSignal(sig, context);
    var finalScore = ai.score;
    if (finalScore === 0) finalScore = 30;
    return {
      ...sig,
      score: finalScore,
      confidence: ai.confidence
    };
  });

  // Ensure exactly 5 max
  signals = signals.filter(function(s) {
    return s.entry && s.tp && s.sl;
  }).slice(0, 5);

  // sort best → worst
  signals.sort(function(a, b) {
    var pa = getPriority(a);
    var pb = getPriority(b);
    if (pb !== pa) return pb - pa;
    return b.score - a.score;
  });

  return signals;
}

module.exports = { generateMultiSignals: generateMultiSignals };