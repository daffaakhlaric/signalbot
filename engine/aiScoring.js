function scoreSignal(signal, context) {
  if (!signal || !context) return { score: 0, confidence: "LOW" };
  let score = 0;

  if (context.htf_bias === signal.type) score += 20;

  if (
    (context.structure === "LL" && signal.type === "SHORT") ||
    (context.structure === "HH" && signal.type === "LONG")
  ) score += 20;

  if (context.smc && context.smc.direction === signal.type) score += 20;
  if (context.ob && context.ob.direction === signal.type) score += 10;
  if (context.fvg && context.fvg.direction === signal.type) score += 5;

  if (context.ema_align === signal.type) score += 10;

  if (signal.type === "LONG" && context.rsi < 40) score += 10;
  if (signal.type === "SHORT" && context.rsi > 60) score += 10;

  if (signal.status === "ACTIVE") score += 5;

  if (signal.name === "SNIPER SUPER") score += 30;
  if (signal.name === "BOS" || signal.name === "BIG BOS") score += 25;

  if (score > 100) score = 100;
  if (score < 15) score = 15;

  return {
    score: score,
    confidence:
      score >= 75 ? "HIGH" :
      score >= 50 ? "MEDIUM" : "LOW"
  };
}

module.exports = { scoreSignal };