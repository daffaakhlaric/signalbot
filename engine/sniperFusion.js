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
    return { type: "FAKE_BREAKOUT", direction: "SHORT", reason: "break high then rejection" };
  }
  if (last.low < prev.low && last.close > prev.low) {
    return { type: "FAKE_BREAKOUT", direction: "LONG", reason: "break low then rejection" };
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

  if (ob && ob.direction === dir && nearZone(price, ob.zone)) {
    score += 15;
    reasons.push("OB zone");
  }
  if (fvg && fvg.direction === dir && nearZone(price, fvg.zone)) {
    score += 10;
    reasons.push("FVG confluence");
  }

  if (smc && smc.direction === dir) {
    score += 15;
    reasons.push("SMC confirm");
  }

  if (score < 60) return null;

  var entry = price;
  var tp = dir === "LONG" ? price + 150 : price - 150;
  var sl = dir === "LONG" ? price - 80 : price + 80;

  return {
    type: dir,
    entry: entry,
    tp: tp,
    sl: sl,
    score: score,
    confidence: score >= 75 ? "HIGH" : "MED",
    reasons: reasons,
    candle: last,
    ob: ob,
    fvg: fvg,
    smc: smc
  };
}

module.exports = { detectEngulfing, detectFakeBreakout, buildSniperSignal };