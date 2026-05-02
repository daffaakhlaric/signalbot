function scoreConfidence(ctx) {
  var s = 0;

  if (ctx.engulfing) s += 15;
  if (ctx.fakeBreakout) s += 20;
  if (ctx.htf_bias && ctx.dir && ctx.htf_bias === ctx.dir) s += 15;
  if (ctx.ob && ctx.ob.hit) s += 15;
  if (ctx.fvg && ctx.fvg.hit) s += 10;
  if (ctx.smc && ctx.smc.confirm) s += 10;

  if (ctx.market) {
    if (ctx.market.choppyLevel === "MED") s -= 10;
    if (ctx.market.choppyLevel === "HIGH") s -= 30;
  }

  return Math.max(0, Math.min(100, s));
}

function mapColor(score) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function buildDCA(signal) {
  var entry = signal.entry;
  var sl = signal.sl;
  var type = signal.type;

  if (!entry || !sl || !type) return null;

  var diff = Math.abs(entry - sl);
  var step = diff * 0.3;

  return [
    { price: entry, size: 0.4 },
    { price: type === "LONG" ? entry - step : entry + step, size: 0.3 },
    { price: type === "LONG" ? entry - step * 2 : entry + step * 2, size: 0.3 }
  ];
}

module.exports = { scoreConfidence, mapColor, buildDCA };
