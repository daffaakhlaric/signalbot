// ── Engulfing Detector ─────────────────────────────────────────
function detectEngulfing(prev, curr) {
  if (!prev || !curr) return null;

  var bullish =
    curr.close > curr.open &&
    prev.close < prev.open &&
    curr.close > prev.open &&
    curr.open < prev.close;

  var bearish =
    curr.close < curr.open &&
    prev.close > prev.open &&
    curr.open > prev.close &&
    curr.close < prev.open;

  if (bullish) return { type: "LONG", strength: "ENGULFING" };
  if (bearish) return { type: "SHORT", strength: "ENGULFING" };

  return null;
}

function detectFakeBreakout(candles) {
  if (!candles || candles.length < 5) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  if (last.high > prev.high && last.close < prev.high) {
    return { type: "FAKE_BREAKOUT", direction: "SHORT", reason: "break high rejection" };
  }
  if (last.low < prev.low && last.close > prev.low) {
    return { type: "FAKE_BREAKOUT", direction: "LONG", reason: "break low rejection" };
  }
  return null;
}

function nearZone(price, zone, tolPct) {
  tolPct = tolPct || 0.002;
  if (!zone) return false;
  var arr = Array.isArray(zone) ? zone : [zone, zone];
  var low = arr[0], high = arr[1];
  var mid = (low + high) / 2;
  return Math.abs(price - mid) / mid <= tolPct;
}

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
  if (!signal || !signal.entry || !signal.sl || !signal.type) return null;
  var diff = Math.abs(signal.entry - signal.sl);
  var step = diff * 0.3;
  return [
    { price: signal.entry, size: 0.4 },
    { price: signal.type === "LONG" ? signal.entry - step : signal.entry + step, size: 0.3 },
    { price: signal.type === "LONG" ? signal.entry - step * 2 : signal.entry + step * 2, size: 0.3 }
  ];
}

function buildSniperSignal(context, candles) {
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  var engulf = detectEngulfing(prev, last);
  var fake = detectFakeBreakout(candles);
  var ob = context.ob;
  var fvg = context.fvg;
  var smc = context.smc;
  var structure = context.structure;
  var htf = context.htf_bias;
  var price = last.close;

  var dir = null;
  var score = 0;
  var reasons = [];
  var nearOB = ob && nearZone(price, ob.zone);
  var nearFVG = fvg && nearZone(price, fvg.zone);

  if (fake) {
    dir = fake.direction;
    score += 40;
    reasons.push("fake breakout");
  } else if (engulf) {
    dir = engulf.type;
    score += 25;
    reasons.push("engulfing");
  }

  if (!dir) return null;

  if ((structure === "LL" || structure === "LH") && dir === "SHORT") {
    score += 15;
    reasons.push("bear structure");
  }
  if ((structure === "HH" || structure === "HL") && dir === "LONG") {
    score += 15;
    reasons.push("bull structure");
  }

  if (htf === dir) {
    score += 20;
    reasons.push("HTF align");
  }

  if (ob && ob.direction === dir && nearOB) {
    score += 15;
    reasons.push("OB zone");
  }
  if (fvg && fvg.direction === dir && nearFVG) {
    score += 10;
    reasons.push("FVG confluence");
  }

  if (smc && smc.direction === dir) {
    score += 15;
    reasons.push("SMC confirm");
  }

  if (score < 40) {
    console.log("SniperFusion: score", score, "< 40, returning null. dir:", dir, "reasons:", reasons);
    return null;
  }

  var confScore = scoreConfidence({
    engulfing: !!engulf,
    fakeBreakout: !!fake,
    htf_bias: htf,
    dir: dir,
    ob: { hit: !!(ob && ob.direction === dir && nearOB) },
    fvg: { hit: !!(fvg && fvg.direction === dir && nearFVG) },
    smc: { confirm: !!(smc && smc.direction === dir) },
    market: context.market || {}
  });

  var entry = price;
  var tp = dir === "LONG" ? price + 150 : price - 150;
  var sl = dir === "LONG" ? price - 80 : price + 80;

  var signal = {
    type: dir,
    entry: entry,
    tp: tp,
    sl: sl,
    score: score,
    confidence: confScore >= 70 ? "HIGH" : confScore >= 40 ? "MED" : "LOW",
    confidenceScore: confScore,
    confidenceColor: mapColor(confScore),
    reasons: reasons,
    candle: last,
    ob: ob,
    fvg: fvg,
    smc: smc
  };

  if (confScore >= 60) {
    signal.dca = buildDCA(signal);
  }

  return signal;
}

module.exports = { detectEngulfing, detectFakeBreakout, buildSniperSignal, scoreConfidence, mapColor, buildDCA };