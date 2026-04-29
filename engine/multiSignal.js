const { scoreSignal } = require("./aiScoring");

function generateMultiSignals(payload, signal, context) {
  const price = payload.close;
  let signals = [];

  // SMC
  if (context.smc?.direction) {
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
  if (context.ob?.zone) {
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
  if (context.fvg?.zone) {
    signals.push({
      name: "FVG",
      type: context.fvg.direction,
      entry: context.fvg.zone,
      tp: [price + (context.fvg.direction === "LONG" ? 200 : -200)],
      sl: context.fvg.direction === "LONG"
        ? context.fvg.zone[0] - 50
        : context.fvg.zone[1] + 50,
      status: "WAIT",
      reason: context.fvg.reason
    });
  }

  // SNIPER
  if (signal.sniperSignal?.direction) {
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

  // AI scoring
  signals = signals.map(sig => {
    const ai = scoreSignal(sig, context);
    return {
      ...sig,
      score: ai.score,
      confidence: ai.confidence
    };
  });

  // sort best → worst
  signals.sort((a, b) => b.score - a.score);

  return signals;
}

module.exports = { generateMultiSignals };