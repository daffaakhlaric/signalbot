const SUPERTREND_CONFIG = {
  atrPeriod: 10,
  atrMultiBase: 3.0,
  adxPeriod: 14,
  adxThreshold: 25,
  emaPeriod: 20,
  squeezeLength: 20,
  minScore: 4
};

const MARKET_REGIME = {
  TRENDING: "TRENDING",
  RANGING: "RANGING",
  CONSOLIDATION: "CONSOLIDATION",
  VOLATILE: "VOLATILE_EXP"
};

const AGGRESSION = {
  CONSERVATIVE: "CONSERVATIVE",
  BALANCED: "BALANCED",
  AGGRESSIVE: "AGGRESSIVE"
};

const AGGRESSION_PARAMS = {
  CONSERVATIVE: { bodyPct: 0.6, bosConfirm: 2, momentumSens: 1.2, volFilter: 1.3, rsiThresh: 55 },
  BALANCED: { bodyPct: 0.5, bosConfirm: 1, momentumSens: 1.0, volFilter: 1.1, rsiThresh: 50 },
  AGGRESSIVE: { bodyPct: 0.4, bosConfirm: 0, momentumSens: 0.8, volFilter: 0.9, rsiThresh: 45 }
};

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function calcSMA(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function getATR(candles, len) {
  len = len || SUPERTREND_CONFIG.atrPeriod;
  if (!candles || candles.length < len + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-len).reduce((a, b) => a + b, 0) / len;
}

function getADX(candles, len) {
  len = len || SUPERTREND_CONFIG.adxPeriod;
  if (!candles || candles.length < len * 2) return 0;
  const trs = [], plusDM = [], minusDM = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low;
    const prevHigh = candles[i - 1].high, prevLow = candles[i - 1].low;
    const upMove = high - prevHigh, downMove = prevLow - low;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const atr = trs.slice(-len).reduce((a, b) => a + b, 0) / len;
  const plusDI = plusDM.slice(-len).reduce((a, b) => a + b, 0) / len / atr * 100;
  const minusDI = minusDM.slice(-len).reduce((a, b) => a + b, 0) / len / atr * 100;
  return Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
}

function getBollingerBands(candles, period, stdDev) {
  period = period || 20;
  stdDev = stdDev || 2;
  if (!candles || candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const sma = calcSMA(closes, period);
  if (!sma) return null;
  const variance = closes.slice(-period).reduce((a, c) => a + Math.pow(c - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: sma + std * stdDev, middle: sma, lower: sma - std * stdDev };
}

function detectSqueeze(candles) {
  if (!candles || candles.length < SUPERTREND_CONFIG.squeezeLength) return false;
  const bb = getBollingerBands(candles, 20, 2);
  if (!bb) return false;
  const atr = getATR(candles, 20);
  if (!atr) return false;
  const keltnerUpper = calcEMA(candles.map(c => c.close), 20) + 2 * atr;
  const keltnerLower = calcEMA(candles.map(c => c.close), 20) - 2 * atr;
  return bb.lower > keltnerLower && bb.upper < keltnerUpper;
}

function detectVolatilityExpansion(candles, len) {
  len = len || 20;
  if (!candles || candles.length < len * 2) return false;
  const atrNow = getATR(candles, 14);
  const atrPrev = getATR(candles.slice(0, -len), 14);
  if (!atrNow || !atrPrev) return false;
  return atrNow > atrPrev * 1.3;
}

function detectConsolidation(candles, len) {
  len = len || 5;
  if (!candles || candles.length < len) return false;
  const recent = candles.slice(-len);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const range = Math.max(...highs) - Math.min(...lows);
  const avgRange = recent.reduce((a, c) => a + (c.high - c.low), 0) / len;
  const closes = recent.map(c => c.close);
  const avgClose = closes.reduce((a, b) => a + b, 0) / len;
  const variance = closes.reduce((a, c) => a + Math.pow(c - avgClose, 2), 0) / len;
  const closeStd = Math.sqrt(variance) / avgClose;
  return range < avgRange * 1.5 && closeStd < 0.02;
}

function detectMarketRegime(candles) {
  if (!candles || candles.length < 50) return MARKET_REGIME.RANGING;
  const adx = getADX(candles);
  const squeeze = detectSqueeze(candles);
  const volExp = detectVolatilityExpansion(candles);
  const consolid = detectConsolidation(candles);
  const atr = getATR(candles, 14);
  const ema20 = calcEMA(candles.map(c => c.close), SUPERTREND_CONFIG.emaPeriod);
  const lastClose = candles[candles.length - 1].close;

  if (volExp) return MARKET_REGIME.VOLATILE;
  if (consolid) return MARKET_REGIME.CONSOLIDATION;
  if (adx > SUPERTREND_CONFIG.adxThreshold && ema20 && lastClose > ema20) return MARKET_REGIME.TRENDING;
  if (adx > SUPERTREND_CONFIG.adxThreshold && ema20 && lastClose < ema20) return MARKET_REGIME.TRENDING;
  if (squeeze) return MARKET_REGIME.RANGING;
  return MARKET_REGIME.RANGING;
}

function calcTrendSlope(candles) {
  if (!candles || candles.length < 20) return 0;
  const ema10 = calcEMA(candles.map(c => c.close), 10);
  const ema30 = calcEMA(candles.map(c => c.close), 30);
  if (!ema10 || !ema30) return 0;
  return (ema10 - ema30) / ema30;
}

function getRSI(candles, len) {
  len = len || 14;
  if (!candles || candles.length < len + 1) return null;
  const closes = candles.map(c => c.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - len; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / len, avgLoss = losses / len;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function detectRSIPullback(candles, direction) {
  if (!candles || candles.length < 15) return null;
  const rsi = getRSI(candles);
  const ema10 = calcEMA(candles.map(c => c.close), 10);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!rsi || !ema10 || !last || !prev) return null;

  if (direction === "LONG") {
    if (prev.close < ema10 && last.close > ema10 && rsi > 45 && rsi < 70) {
      return { type: "LONG", rsi: rsi, reason: "RSI reclaim above EMA" };
    }
    if (last.close > ema10 && rsi > 50 && rsi < 65) {
      return { type: "LONG", rsi: rsi, reason: "RSI momentum continuation" };
    }
  } else {
    if (prev.close > ema10 && last.close < ema10 && rsi < 55 && rsi > 30) {
      return { type: "SHORT", rsi: rsi, reason: "RSI reclaim below EMA" };
    }
    if (last.close < ema10 && rsi < 50 && rsi > 35) {
      return { type: "SHORT", rsi: rsi, reason: "RSI momentum continuation" };
    }
  }
  return null;
}

function detectMomentumAcceleration(candles) {
  if (!candles || candles.length < 20) return null;
  const volumes = candles.slice(-20).map(c => c.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / 20;
  const lastVol = candles[candles.length - 1].volume;
  const volRatio = lastVol / avgVol;

  const ema5 = calcEMA(candles.map(c => c.close), 5);
  const ema10 = calcEMA(candles.map(c => c.close), 10);
  if (!ema5 || !ema10) return null;

  if (volRatio > 1.2 && ema5 > ema10) {
    return { type: "LONG", momentum: "ACCELERATING", volRatio: volRatio };
  }
  if (volRatio > 1.2 && ema5 < ema10) {
    return { type: "SHORT", momentum: "ACCELERATING", volRatio: volRatio };
  }
  return null;
}

function calculateAIScore(ctx) {
  let s = 0;

  if (ctx.trendStrength >= 80) s += 20;
  else if (ctx.trendStrength >= 60) s += 15;
  else if (ctx.trendStrength >= 40) s += 10;
  else if (ctx.trendStrength >= 20) s += 5;

  if (ctx.breakoutQuality === "HIGH") s += 20;
  else if (ctx.breakoutQuality === "MED") s += 12;
  else if (ctx.breakoutQuality === "LOW") s += 5;

  if (ctx.regimeAlignment) s += 15;

  if (ctx.volatility < 30) s += 10;
  else if (ctx.volatility < 50) s += 5;

  if (ctx.structureConsistency >= 80) s += 15;
  else if (ctx.structureConsistency >= 60) s += 10;
  else if (ctx.structureConsistency >= 40) s += 5;

  if (ctx.liquiditySweepQuality === "HIGH") s += 10;
  else if (ctx.liquiditySweepQuality === "MED") s += 5;

  if (ctx.rrQuality >= 2.0) s += 10;
  else if (ctx.rrQuality >= 1.5) s += 5;

  if (ctx.winRate >= 70) s += 10;
  else if (ctx.winRate >= 55) s += 5;

  if (ctx.adx > 30) s += 5;
  else if (ctx.adx < 20) s -= 10;

  if (ctx.squeeze) s -= 5;

  if (ctx.marketMode === MARKET_REGIME.CONSOLIDATION) s -= 10;
  if (ctx.marketMode === MARKET_REGIME.VOLATILE) s += 5;

  return Math.max(0, Math.min(100, s));
}

function getConfidenceTier(score) {
  if (score >= 90) return "ELITE";
  if (score >= 75) return "STRONG";
  if (score >= 60) return "VALID";
  return "WEAK";
}

function detectStructure(candles) {
  if (!candles || candles.length < 10) return { type: "SIDEWAYS", hh: null, hl: null, lh: null, ll: null };
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const swingHigh = Math.max(...highs.slice(-10));
  const swingLow = Math.min(...lows.slice(-10));
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  if (last.high > prev.high && last.high > swingHigh) {
    return { type: "BULL_BOS", hh: last.high, hl: null, lh: null, ll: null };
  }
  if (last.low < prev.low && last.low < swingLow) {
    return { type: "BEAR_BOS", hh: null, hl: null, lh: last.low, ll: null };
  }
  if (last.close > last.open) {
    return { type: "BULLISH", hh: null, hl: last.low, lh: null, ll: null };
  }
  return { type: "BEARISH", hh: null, hl: null, lh: last.high, ll: null };
}

function buildConsolidationBox(candles) {
  if (!candles || candles.length < 5) return null;
  const recent = candles.slice(-8);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgClose = recent.map(c => c.close).reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.map(c => c.close).reduce((a, c) => a + Math.pow(c - avgClose, 2), 0) / recent.length;
  const closeStd = Math.sqrt(variance) / avgClose;
  if (maxHigh - minLow < avgClose * 0.02 || closeStd > 0.015) return null;
  return { high: maxHigh, low: minLow, center: (maxHigh + minLow) / 2 };
}

function calculateDynamicMultiplier(ctx) {
  let multi = SUPERTREND_CONFIG.atrMultiBase;

  if (ctx.adx > 35) multi *= 0.7;
  else if (ctx.adx > 30) multi *= 0.85;
  else if (ctx.adx > 25) multi *= 1.0;
  else if (ctx.adx < 20) multi *= 1.4;
  else if (ctx.adx < 15) multi *= 1.7;

  if (ctx.squeeze) multi *= 1.5;

  if (ctx.volatilityExp) multi *= 0.8;

  if (ctx.regime === MARKET_REGIME.TRENDING) multi *= 0.75;
  else if (ctx.regime === MARKET_REGIME.CONSOLIDATION) multi *= 1.3;
  else if (ctx.regime === MARKET_REGIME.VOLATILE) multi *= 0.9;

  if (ctx.aggression === AGGRESSION.AGGRESSIVE) multi *= 0.8;
  else if (ctx.aggression === AGGRESSION.CONSERVATIVE) multi *= 1.2;

  return Math.max(1.0, Math.min(5.0, multi));
}

function computeAdaptiveSupertrend(candles, aggression) {
  if (!candles || candles.length < 30) return null;
  aggression = aggression || AGGRESSION.BALANCED;
  const params = AGGRESSION_PARAMS[aggression];

  const atr = getATR(candles, SUPERTREND_CONFIG.atrPeriod);
  const adx = getADX(candles);
  const regime = detectMarketRegime(candles);
  const squeeze = detectSqueeze(candles);
  const volExp = detectVolatilityExpansion(candles);
  const structure = detectStructure(candles);
  const ema20 = calcEMA(candles.map(c => c.close), SUPERTREND_CONFIG.emaPeriod);
  const emaSlope = calcTrendSlope(candles);
  const rsi = getRSI(candles);
  const momAccel = detectMomentumAcceleration(candles);
  const consolidBox = buildConsolidationBox(candles);

  if (!atr || !ema20) return null;

  const ctx = {
    adx: adx,
    regime: regime,
    squeeze: squeeze,
    volatilityExp: volExp,
    aggression: aggression,
    trendStrength: Math.min(100, adx * 3),
    breakoutQuality: "LOW",
    regimeAlignment: false,
    volatility: atr / candles[candles.length - 1].close * 100,
    structureConsistency: 50,
    liquiditySweepQuality: "LOW",
    rrQuality: 1.5,
    winRate: 55,
    marketMode: regime
  };

  if (structure.type === "BULL_BOS" || structure.type === "BEAR_BOS") {
    ctx.breakoutQuality = "HIGH";
    ctx.structureConsistency = 80;
  } else if (structure.type === "BULLISH" || structure.type === "BEARISH") {
    ctx.breakoutQuality = "MED";
    ctx.structureConsistency = 60;
  }

  if ((regime === MARKET_REGIME.TRENDING && emaSlope > 0) || (regime === MARKET_REGIME.TRENDING && emaSlope < 0)) {
    ctx.regimeAlignment = true;
  }

  if (momAccel) ctx.liquiditySweepQuality = "HIGH";

  const multi = calculateDynamicMultiplier(ctx);
  const upperBand = ema20 + atr * multi;
  const lowerBand = ema20 - atr * multi;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  let trend = "LONG";
  let supertrend = lowerBand;
  let direction = 1;

  if (last.close < upperBand) {
    trend = "SHORT";
    supertrend = upperBand;
    direction = -1;
  }

  if (prev) {
    if (direction === 1 && last.close > upperBand) {
      trend = "LONG";
      supertrend = lowerBand;
    } else if (direction === -1 && last.close < lowerBand) {
      trend = "SHORT";
      supertrend = upperBand;
    }
  }

  const aiScore = calculateAIScore(ctx);
  const tier = getConfidenceTier(aiScore);

  const entry = last.close;
  const sl = trend === "LONG" ? last.close - atr * 1.5 : last.close + atr * 1.5;
  const tp = trend === "LONG" ? last.close + atr * 2.5 : last.close - atr * 2.5;
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);

  return {
    type: trend,
    direction: trend,
    signalType: "SUPERTREND_ADAPTIVE",
    signalName: "🤖 AI SUPERTREND",
    status: "ACTIVE",
    entry: entry,
    tp: tp,
    sl: sl,
    rr: rr,
    aiScore: aiScore,
    confidenceTier: tier,
    atr: atr,
    adx: adx,
    regime: regime,
    squeeze: squeeze,
    volExp: volExp,
    structure: structure,
    emaSlope: emaSlope,
    rsi: rsi,
    momentum: momAccel,
    consolidBox: consolidBox,
    multi: multi,
    marketMode: regime,
    reasons: [
      "adaptive_supertrend",
      "regime=" + regime,
      "squeeze=" + (squeeze ? "true" : "false"),
      "ai_score=" + aiScore
    ],
    predictedMovePct: (rr * atr / entry * 100).toFixed(2),
    trendStrength: ctx.trendStrength,
    breakoutQuality: ctx.breakoutQuality,
    candle: { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close }
  };
}

function getSignalFromRegime(candles, aggression) {
  if (!candles || candles.length < 30) return null;
  aggression = aggression || AGGRESSION.BALANCED;
  const params = AGGRESSION_PARAMS[aggression];

  const regime = detectMarketRegime(candles);
  const momAccel = detectMomentumAcceleration(candles);
  const rsiPull = detectRSIPullback(candles, "LONG") || detectRSIPullback(candles, "SHORT");
  const consolidBox = buildConsolidationBox(candles);
  const supertrend = computeAdaptiveSupertrend(candles, aggression);
  const structure = detectStructure(candles);
  const ema20 = calcEMA(candles.map(c => c.close), 20);
  const last = candles[candles.length - 1];

  if (!supertrend || !ema20) return null;

  let direction = supertrend.direction;
  let status = "WAIT";
  let reasons = supertrend.reasons || [];

  if (regime === MARKET_REGIME.TRENDING) {
    if (momAccel && momAccel.type === direction) {
      status = "ENTRY";
      reasons.push("momentum_acceleration");
    }
    if (rsiPull && rsiPull.type === direction) {
      status = "ENTRY";
      reasons.push("rsi_pullback_confirm");
    }
    if (structure.type === "BULL_BOS" && direction === "LONG") {
      status = "ENTRY";
      reasons.push("bull_bos_confirm");
    }
    if (structure.type === "BEAR_BOS" && direction === "SHORT") {
      status = "ENTRY";
      reasons.push("bear_bos_confirm");
    }
  }

  if (regime === MARKET_REGIME.RANGING) {
    if (consolidBox && last.close > consolidBox.high && direction === "LONG") {
      status = "PREPARE";
      reasons.push("breakout_pressure_long");
    }
    if (consolidBox && last.close < consolidBox.low && direction === "SHORT") {
      status = "PREPARE";
      reasons.push("breakout_pressure_short");
    }
    if (rsiPull && Math.abs(rsiPull.rsi - 50) < 10) {
      status = "PREPARE";
      reasons.push("range_boundary_rsi");
    }
  }

  if (regime === MARKET_REGIME.CONSOLIDATION) {
    status = "PREPARE";
    reasons.push("consolidation_detected");
  }

  if (regime === MARKET_REGIME.VOLATILE && momAccel) {
    status = "ENTRY";
    reasons.push("volatile_momentum_entry");
  }

  if (supertrend.aiScore < 50) {
    status = "WAIT";
    reasons.push("low_ai_confidence");
  }

  if (status === "WAIT") return null;

  const entry = last.close;
  const atr = supertrend.atr || getATR(candles, 14) || 1;
  const sl = direction === "LONG" ? entry - atr * params.bodyPct * 10 : entry + atr * params.bodyPct * 10;
  const tp = direction === "LONG" ? entry + atr * params.bodyPct * 20 : entry - atr * params.bodyPct * 20;

  return {
    type: direction,
    direction: direction,
    signalType: "SUPERTREND_ADAPTIVE",
    signalName: "🤖 AI SUPERTREND",
    status: status,
    entry: entry,
    tp: tp,
    sl: sl,
    rr: Math.abs(tp - entry) / Math.abs(entry - sl),
    aiScore: supertrend.aiScore,
    confidenceTier: supertrend.confidenceTier,
    atr: atr,
    regime: regime,
    consolidBox: consolidBox,
    structure: structure,
    marketMode: regime,
    reasons: reasons,
    predictedMovePct: supertrend.predictedMovePct,
    candle: supertrend.candle
  };
}

function buildAdaptiveCard(signal, candles) {
  if (!signal) return null;
  const regime = signal.regime || detectMarketRegime(candles);
  return {
    pair: "LABUSDT",
    direction: signal.direction,
    signalType: signal.signalType,
    signalName: signal.signalName,
    score: signal.aiScore,
    aiScore: signal.aiScore,
    confidenceTier: signal.confidenceTier,
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    rr: signal.rr,
    trend: signal.direction,
    mode: regime,
    reason: signal.reasons ? signal.reasons.join(", ") : signal.signalName,
    status: signal.status,
    signal_name: signal.signalName,
    atr: signal.atr,
    regime: regime,
    consolidBox: signal.consolidBox,
    structure: signal.structure,
    predictedMove: signal.predictedMovePct,
    predictedMovePct: signal.predictedMovePct,
    aiPanel: {
      direction: signal.direction,
      aiScore: signal.aiScore,
      confidenceTier: signal.confidenceTier,
      marketMode: regime,
      predictedMove: signal.predictedMovePct,
      signalType: signal.signalType,
      signalName: signal.signalName,
      regime: regime,
      adx: signal.adx,
      squeeze: signal.squeeze,
      volExp: signal.volExp,
      trendStrength: signal.trendStrength,
      breakoutQuality: signal.breakoutQuality
    },
    candle: signal.candle
  };
}

function getAnalyticsHUD(candles, aggression) {
  if (!candles || candles.length < 30) return null;
  aggression = aggression || AGGRESSION.BALANCED;
  const supertrend = computeAdaptiveSupertrend(candles, aggression);
  if (!supertrend) return null;
  const regime = detectMarketRegime(candles);
  const adx = getADX(candles);
  const rsi = getRSI(candles);
  const squeeze = detectSqueeze(candles);
  const volExp = detectVolatilityExpansion(candles);
  const consolidBox = buildConsolidationBox(candles);
  const emaSlope = calcTrendSlope(candles);
  const momAccel = detectMomentumAcceleration(candles);

  return {
    marketState: regime,
    trendStrength: Math.round(supertrend.trendStrength),
    aiConfidence: superstress.aiScore,
    strategyMode: "AI SUPERTREND",
    aggressionLevel: aggression,
    volatilityState: volExp ? "EXPANDING" : squeeze ? "SQUEEZED" : "NORMAL",
    winRate: 55 + Math.round(supertrend.aiScore * 0.3),
    predictedMove: supertrend.predictedMovePct,
    rrRatio: supertrend.rr ? supertrend.rr.toFixed(1) : "--",
    signalQuality: supertrend.confidenceTier,
    adx: Math.round(adx),
    rsi: rsi ? Math.round(rsi) : "--",
    squeeze: squeeze,
    volExpansion: volExp,
    consolidBox: consolidBox,
    emaSlope: emaSlope ? (emaSlope * 100).toFixed(2) : "0.00",
    momentum: momAccel ? momAccel.type : "NEUTRAL",
    multi: supertrend.multi ? supertrend.multi.toFixed(1) : "3.0",
    bullBear: supertrend.direction
  };
}

module.exports = {
  SUPERTREND_CONFIG,
  MARKET_REGIME,
  AGGRESSION,
  AGGRESSION_PARAMS,
  computeAdaptiveSupertrend,
  getSignalFromRegime,
  buildAdaptiveCard,
  getAnalyticsHUD,
  detectMarketRegime,
  getATR,
  getADX,
  detectSqueeze,
  detectVolatilityExpansion,
  detectConsolidation,
  calculateAIScore,
  getConfidenceTier,
  calcEMA,
  getRSI
};