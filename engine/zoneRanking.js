function rankZone(zone, context) {
  var score = 0;

  if (context.htf_bias && zone.direction && context.htf_bias === zone.direction) {
    score += 25;
  }

  if (zone.type === "OB") {
    score += 20;
  } else if (zone.type === "FVG") {
    score += 10;
  }

  if (context.smc && context.smc.direction && context.smc.direction === zone.direction) {
    score += 20;
  }

  if (context.sweep && context.sweep.direction && context.sweep.direction === zone.direction) {
    score += 15;
  }

  if (!zone.mitigated) {
    score += 10;
  }

  if (context.volatility && context.volatility > 50) {
    score += 10;
  }

  if (score > 100) score = 100;

  var strength = score >= 70 ? "STRONG" : score >= 40 ? "MEDIUM" : "WEAK";

  return { score: score, strength: strength };
}

function buildLiquidityHeatmap(pivots) {
  var clusters = {};

  pivots.forEach(function(p) {
    var key = Math.round(p.price / 50) * 50;
    if (!clusters[key]) clusters[key] = 0;
    clusters[key]++;
  });

  return Object.keys(clusters).map(function(price) {
    return { price: Number(price), strength: clusters[price] };
  });
}

module.exports = { rankZone, buildLiquidityHeatmap };
