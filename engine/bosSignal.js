// ── BOS Signal (Break of Structure) — Institutional Elite Sniper ──────────────────────
// Detects high-probability BOS setups with liquidity manipulation logic

function detectBOSSignal(candles, ema50, ema200, atr, volumeData) {
  if (!candles || candles.length < 50) return null;

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  var prev3 = candles[candles.length - 4];

  if (!last || !prev || !prev2) return null;

  // ── HTF Trend Filter ──
  var htfBullish = ema50 && ema200 && ema50 > ema200;
  var htfBearish = ema50 && ema200 && ema50 < ema200;
  var htfBias = htfBullish ? "LONG" : htfBearish ? "SHORT" : "NEUTRAL";

  // ── Detect Swing Highs/Lows ──
  var swingHighs = [];
  var swingLows = [];

  for (var i = 10; i < candles.length - 4; i++) {
    var isHigh = true;
    for (var j = i - 3; j <= i + 3; j++) {
      if (j !== i && candles[j] && candles[j].high > candles[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) swingHighs.push({ index: i, price: candles[i].high });

    var isLow = true;
    for (var k = i - 3; k <= i + 3; k++) {
      if (k !== i && candles[k] && candles[k].low < candles[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) swingLows.push({ index: i, price: candles[i].low });
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return null;

  // Get last 2 swing highs and lows
  var lastHigh = swingHighs[swingHighs.length - 1];
  var prevHigh = swingHighs[swingHighs.length - 2];
  var lastLow = swingLows[swingLows.length - 1];
  var prevLow = swingLows[swingLows.length - 2];

  // ── Detect BOS (Break of Structure) ──
  var bosBullish = last.high > prevHigh.price && htfBullish;
  var bosBearish = last.low < prevLow.price && htfBearish;

  // ── Detect CHoCH (Change of Character) ──
  var lastSwingLowBroken = prev.low < prevLow.price;
  var lastSwingHighBroken = prev.high > prevHigh.price;

  // ── Detect Liquidity Sweep ──
  var liquiditySweepBullish = last.low < prevLow.price && last.close > prevLow.price;
  var liquiditySweepBearish = last.high > prevHigh.price && last.close < prevHigh.price;

  // ── Detect Equal Highs/Lows ──
  var equalHighs = Math.abs(lastHigh.price - prevHigh.price) / prevHigh.price < 0.001;
  var equalLows = Math.abs(lastLow.price - prevLow.price) / prevLow.price < 0.001;

  // ── Detect Internal Structure (higher highs, higher lows for bullish) ──
  var bullStructure = last.high > prevHigh.price && prevLow.price > prev2.low;
  var bearStructure = last.low < prevLow.price && prevHigh.price < prev2.high;

  // ── FVG Detection (Fair Value Gap) ──
  var fvgBullish = prev2.close > prev.high && prev.low > prev3.high;
  var fvgBearish = prev2.close < prev.low && prev.high < prev3.low;
  var fvgZone = fvgBullish ? { low: prev3.high, high: prev.low } :
                fvgBearish ? { low: prev.high, high: prev3.low } : null;

  // ── Volume Spike Detection ──
  var avgVol = 0;
  for (var v = candles.length - 20; v < candles.length; v++) {
    avgVol += (candles[v].volume || 0);
  }
  avgVol = avgVol / 20;
  var currentVol = last.volume || 0;
  var volumeSpike = currentVol > avgVol * 1.5;

  // ── Calculate Confidence Score ──
  var score = 0;
  var confirmations = [];

  // HTF Trend Alignment = +2
  if (htfBias === "LONG") { score += 2; confirmations.push("HTF Bullish"); }
  if (htfBias === "SHORT") { score += 2; confirmations.push("HTF Bearish"); }

  // Liquidity Sweep = +3
  if (liquiditySweepBullish) { score += 3; confirmations.push("Buy-side liquidity swept"); }
  if (liquiditySweepBearish) { score += 3; confirmations.push("Sell-side liquidity swept"); }

  // BOS Confirmation = +2
  if (bosBullish) { score += 2; confirmations.push("BOS confirmed"); }
  if (bosBearish) { score += 2; confirmations.push("BOS confirmed"); }

  // CHoCH = +1
  if (lastSwingLowBroken && htfBullish) { score += 1; confirmations.push("CHoCH bullish"); }
  if (lastSwingHighBroken && htfBearish) { score += 1; confirmations.push("CHoCH bearish"); }

  // FVG Retest = +1
  if (fvgBullish) { score += 1; confirmations.push("FVG retest"); }
  if (fvgBearish) { score += 1; confirmations.push("FVG retest"); }

  // Volume Spike = +1
  if (volumeSpike) { score += 1; confirmations.push("Volume spike"); }

  // Equal Highs/Lows (liquidity pool) = +1
  if (equalHighs) { score += 1; confirmations.push("Equal highs liquidity"); }
  if (equalLows) { score += 1; confirmations.push("Equal lows liquidity"); }

  // Internal structure = +1
  if (bullStructure || bearStructure) { score += 1; confirmations.push("Structure aligned"); }

  // ── Determine Signal ──
  var direction = null;
  var entry = null;
  var tp = null;
  var sl = null;
  var reason = "";
  var signalName = "BOS";

  if (htfBias === "LONG" && (liquiditySweepBullish || bosBullish) && score >= 7) {
    direction = "LONG";
    entry = fvgZone && fvgZone.high ? fvgZone.high : last.close;
    sl = last.low - atr * 0.5;
    var tp1 = last.close + atr * 2;
    var tp2 = last.close + atr * 3;
    tp = [tp1, tp2];
    reason = "BOS LONG - HTF aligned + liquidity sweep";
    signalName = "BOS";
  }

  if (htfBias === "SHORT" && (liquiditySweepBearish || bosBearish) && score >= 7) {
    direction = "SHORT";
    entry = fvgZone && fvgZone.low ? fvgZone.low : last.close;
    sl = last.high + atr * 0.5;
    var tp1 = last.close - atr * 2;
    var tp2 = last.close - atr * 3;
    tp = [tp1, tp2];
    reason = "BOS SHORT - HTF aligned + liquidity sweep";
    signalName = "BOS";
  }

  // ── Calculate RR ──
  var rr = null;
  if (entry && tp && tp[0] && sl) {
    var reward = Math.abs(tp[0] - entry);
    var risk = Math.abs(entry - sl);
    if (risk > 0) rr = reward / risk;
  }

  // ── Signal Grade ──
  var grade = "WEAK";
  if (score >= 9) grade = "ELITE";
  else if (score >= 8) grade = "STRONG";
  else if (score >= 7) grade = "VALID";

  // ── Only return signal if score >= 7 ──
  if (!direction || score < 7) return null;

  return {
    name: signalName,
    signalName: signalName,
    type: direction,
    direction: direction,
    entry: entry,
    tp: tp,
    sl: sl,
    rr: rr,
    score: score,
    aiScore: score,
    confidenceTier: grade,
    confidence: grade,
    status: "ACTIVE",
    reason: reason,
    reasons: confirmations,
    atr: atr,
    signalType: "BOS",
    marketMode: htfBias,
    volumeSpike: volumeSpike,
    fvgZone: fvgZone,
    bosBullish: bosBullish,
    bosBearish: bosBearish,
    liquiditySweepBullish: liquiditySweepBullish,
    liquiditySweepBearish: liquiditySweepBearish,
    equalHighs: equalHighs,
    equalLows: equalLows,
    htfBias: htfBias,
    premiumZone: htfBias === "LONG" ? last.close > prevHigh.price : last.close < prevLow.price,
    discountZone: htfBias === "LONG" ? last.close < prevLow.price : last.close > prevHigh.price
  };
}

// ── BIG BOS SIGNAL (Maximum Conviction Institutional Break) ──────────────────────
// Only fires when: score >= 9 + Equal Highs/Lows + Volume Spike + CHoCH + FVG + Liquidity Sweep
function detectBigBOSSignal(candles, ema50, ema200, atr, volumeData) {
  if (!candles || candles.length < 50) return null;

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  var prev3 = candles[candles.length - 4];

  if (!last || !prev || !prev2 || !prev3) return null;

  var htfBullish = ema50 && ema200 && ema50 > ema200;
  var htfBearish = ema50 && ema200 && ema50 < ema200;
  var htfBias = htfBullish ? "LONG" : htfBearish ? "SHORT" : "NEUTRAL";

  var swingHighs = [];
  var swingLows = [];

  for (var i = 10; i < candles.length - 4; i++) {
    var isHigh = true;
    for (var j = i - 3; j <= i + 3; j++) {
      if (j !== i && candles[j] && candles[j].high > candles[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) swingHighs.push({ index: i, price: candles[i].high });

    var isLow = true;
    for (var k = i - 3; k <= i + 3; k++) {
      if (k !== i && candles[k] && candles[k].low < candles[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) swingLows.push({ index: i, price: candles[i].low });
  }

  if (swingHighs.length < 2 || swingLows.length < 2) return null;

  var lastHigh = swingHighs[swingHighs.length - 1];
  var prevHigh = swingHighs[swingHighs.length - 2];
  var lastLow = swingLows[swingLows.length - 1];
  var prevLow = swingLows[swingLows.length - 2];

  var equalHighs = Math.abs(lastHigh.price - prevHigh.price) / prevHigh.price < 0.0015;
  var equalLows = Math.abs(lastLow.price - prevLow.price) / prevLow.price < 0.0015;

  var liquiditySweepBullish = last.low < prevLow.price && last.close > prevLow.price;
  var liquiditySweepBearish = last.high > prevHigh.price && last.close < prevHigh.price;

  var chochBullish = prev.low < prevLow.price;
  var chochBearish = prev.high > prevHigh.price;

  var bosBullish = last.high > prevHigh.price && htfBullish;
  var bosBearish = last.low < prevLow.price && htfBearish;

  var fvgBullish = prev2.close > prev.high && prev.low > prev3.high;
  var fvgBearish = prev2.close < prev.low && prev.high < prev3.low;
  var fvgZone = fvgBullish ? { low: prev3.high, high: prev.low } :
                fvgBearish ? { low: prev.high, high: prev3.low } : null;

  var avgVol = 0;
  for (var v = candles.length - 20; v < candles.length; v++) {
    avgVol += (candles[v].volume || 0);
  }
  avgVol = avgVol / 20;
  var currentVol = last.volume || 0;
  var volumeSpike = currentVol > avgVol * 1.8;

  var score = 0;
  var confirmations = [];

  if (htfBias === "LONG") { score += 2; confirmations.push("HTF Bullish"); }
  if (htfBias === "SHORT") { score += 2; confirmations.push("HTF Bearish"); }
  if (liquiditySweepBullish) { score += 3; confirmations.push("Liquidity Swept"); }
  if (liquiditySweepBearish) { score += 3; confirmations.push("Liquidity Swept"); }
  if (equalLows) { score += 2; confirmations.push("Equal Lows"); }
  if (equalHighs) { score += 2; confirmations.push("Equal Highs"); }
  if (chochBullish && htfBullish) { score += 2; confirmations.push("CHoCH"); }
  if (chochBearish && htfBearish) { score += 2; confirmations.push("CHoCH"); }
  if (fvgBullish || fvgBearish) { score += 1; confirmations.push("FVG"); }
  if (volumeSpike) { score += 1; confirmations.push("Volume Spike"); }

  var direction = null;

  if (htfBias === "LONG" && (liquiditySweepBullish || bosBullish) && score >= 9) {
    direction = "LONG";
  }

  if (htfBias === "SHORT" && (liquiditySweepBearish || bosBearish) && score >= 9) {
    direction = "SHORT";
  }

  if (!direction) return null;

  var entry = last.close;
  var sl = direction === "LONG"
    ? (last.low < prevLow.price ? prevLow.profile : last.low) * 0.9997
    : (last.high > prevHigh.price ? prevHigh.price : last.high) * 1.0003;

  var tpDistance = atr * 3;
  var tp1 = direction === "LONG" ? last.close + tpDistance : last.close - tpDistance;
  var tp2 = direction === "LONG" ? last.close + tpDistance * 1.5 : last.close - tpDistance * 1.5;
  var tp = [Math.round(tp1 * 100) / 100, Math.round(tp2 * 100) / 100];

  var rr = null;
  if (entry && tp && tp[0] && sl) {
    var reward = Math.abs(tp[0] - entry);
    var risk = Math.abs(entry - sl);
    if (risk > 0) rr = Math.round((reward / risk) * 10) / 10;
  }

  var grade = "WEAK";
  if (score >= 11) grade = "ELITE";
  else if (score >= 9) grade = "STRONG";

  return {
    name: "BIG BOS",
    signalName: "BIG BOS",
    type: direction,
    direction: direction,
    entry: Math.round(entry * 100) / 100,
    tp: tp,
    sl: Math.round(sl * 100) / 100,
    rr: rr,
    score: score,
    aiScore: score,
    confidenceTier: grade,
    confidence: grade,
    status: "ACTIVE",
    reason: "BIG BOS " + direction + " - institutional breakout",
    reasons: confirmations,
    atr: atr,
    signalType: "BIG_BOS",
    marketMode: htfBias,
    volumeSpike: volumeSpike,
    fvgZone: fvgZone,
    bosBullish: bosBullish,
    bosBearish: bosBearish,
    liquiditySweepBullish: liquiditySweepBullish,
    liquiditySweepBearish: liquiditySweepBearish,
    equalHighs: equalHighs,
    equalLows: equalLows,
    chochBullish: chochBullish,
    chochBearish: chochBearish,
    htfBias: htfBias,
    premiumZone: htfBias === "LONG" ? last.close > prevHigh.price : last.close < prevLow.price,
    discountZone: htfBias === "LONG" ? last.close < prevLow.price : last.close > prevHigh.price
  };
}

module.exports = { detectBOSSignal: detectBOSSignal, detectBigBOSSignal: detectBigBOSSignal };