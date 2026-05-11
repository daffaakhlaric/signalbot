const LAB_CONFIG = {
  symbol: "LAB-USDT",
  leverage: 20,
  risk_per_trade: 0.05,
  tf_entry: "5m",
  tf_trend: "15m",
  atr_sl: 0.8,
  atr_tp: 1.5,
  min_rr: 1.3,
  trailing_trigger: 0.7,
  trailing_distance: 0.35,
  volume_multiplier: 1.2,
  scalp_tp: 0.7,
  scalp_sl: 0.45,
  mode: "SNIPER",
  min_score: 4
};

const SIGNAL_TYPES = {
  PRE_SNIPER: "PRE_SNIPER",
  SNIPER_SUPER: "SNIPER_SUPER",
  LTF_SNIPER: "LTF_SNIPER",
  SMC: "SMC",
  MOMENTUM_BREAK: "MOMENTUM_BREAK",
  TREND_RIDER: "TREND_RIDER"
};

const PRIORITY = {
  SNIPER_SUPER: 1,
  LTF_SNIPER: 2,
  PRE_SNIPER: 3,
  SMC: 4,
  TREND_RIDER: 5,
  MOMENTUM_BREAK: 6
};

const CONFIDENCE_TIERS = {
  ELITE: 90,
  STRONG: 75,
  VALID: 60,
  WEAK: 0
};

const MARKET_MODES = {
  TRENDING: "TRENDING",
  SIDEWAYS: "SIDEWAYS",
  CHOPPY: "CHOPPY"
};

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function getATR(data, len) {
  len = len || 14;
  if (!data || data.length < len + 1) return null;
  var trs = [];
  for (var i = 1; i < data.length; i++) {
    var high = data[i].high;
    var low = data[i].low;
    var prevClose = data[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-len).reduce(function(a, b) { return a + b; }, 0) / len;
}

function round(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

function getTrendBias(candles) {
  if (!candles || candles.length < 32) return "NEUTRAL";
  const ema5 = calcEMA(candles.map(c => c.close), 5);
  const ema10 = calcEMA(candles.map(c => c.close), 10);
  const ema30 = calcEMA(candles.map(c => c.close), 30);
  if (ema5 > ema10 && ema10 > ema30) return "LONG";
  if (ema5 < ema10 && ema10 < ema30) return "SHORT";
  return "NEUTRAL";
}

function detectMarketMode(candles) {
  if (!candles || candles.length < 50) return MARKET_MODES.CHOPPY;
  var ema5 = calcEMA(candles.map(c => c.close), 5);
  var ema20 = calcEMA(candles.map(c => c.close), 20);
  if (!ema5 || !ema20) return MARKET_MODES.CHOPPY;
  var adx = calculateADX(candles, 14);
  if (adx > 25) return MARKET_MODES.TRENDING;
  if (adx < 20) return MARKET_MODES.SIDEWAYS;
  return MARKET_MODES.CHOPPY;
}

function calculateADX(candles, len) {
  len = len || 14;
  if (!candles || candles.length < len * 2) return 0;
  var trs = [];
  var plusDM = [];
  var minusDM = [];
  for (var i = 1; i < candles.length; i++) {
    var high = candles[i].high;
    var low = candles[i].low;
    var prevHigh = candles[i - 1].high;
    var prevLow = candles[i - 1].low;
    var tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    var upMove = high - prevHigh;
    var downMove = prevLow - low;
    trs.push(tr);
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  var atr = trs.slice(-len).reduce(function(a, b) { return a + b; }, 0) / len;
  var plusDI = plusDM.slice(-len).reduce(function(a, b) { return a + b; }, 0) / len / atr * 100;
  var minusDI = minusDM.slice(-len).reduce(function(a, b) { return a + b; }, 0) / len / atr * 100;
  var dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  return dx;
}

function isStrongBull(c) {
  if (!c) return false;
  var body = Math.abs(c.close - c.open);
  var range = c.high - c.low;
  return range > 0 && c.close > c.open && body / range > 0.6;
}

function isStrongBear(c) {
  if (!c) return false;
  var body = Math.abs(c.close - c.open);
  var range = c.high - c.low;
  return range > 0 && c.close < c.open && body / range > 0.6;
}

function bullishRejection(c) {
  if (!c) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var lowerWick = Math.min(c.open, c.close) - c.low;
  return lowerWick / range > 0.35;
}

function bearishRejection(c) {
  if (!c) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var upperWick = c.high - Math.max(c.open, c.close);
  return upperWick / range > 0.35;
}

function volumeSpike(data) {
  if (!data || data.length < 10) return false;
  var last = data[data.length - 1];
  var avg = data.slice(-10).reduce(function(a, b) { return a + b.volume; }, 0) / 10;
  return last.volume > avg * LAB_CONFIG.volume_multiplier;
}

function fakeBreakoutShort(c, resistance) {
  if (!c || !resistance) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var upperWick = c.high - Math.max(c.open, c.close);
  return c.high > resistance && c.close < resistance && upperWick / range > 0.4;
}

function fakeBreakoutLong(c, support) {
  if (!c || !support) return false;
  var range = c.high - c.low;
  if (range === 0) return false;
  var lowerWick = Math.min(c.open, c.close) - c.low;
  return c.low < support && c.close > support && lowerWick / range > 0.4;
}

function detectCompression(candles, len) {
  len = len || 10;
  if (!candles || candles.length < len) return false;
  var recent = candles.slice(-len);
  var highs = recent.map(function(c) { return c.high; });
  var lows = recent.map(function(c) { return c.low; });
  var maxHigh = Math.max.apply(null, highs);
  var minLow = Math.min.apply(null, lows);
  var range = maxHigh - minLow;
  var avgRange = recent.reduce(function(a, c) { return a + (c.high - c.low); }, 0) / len;
  return range < avgRange * 1.5;
}

function detectVolatilitySqueeze(candles, len) {
  len = len || 20;
  if (!candles || candles.length < len) return false;
  var atr = getATR(candles, 14);
  var ema20 = calcEMA(candles.map(function(c) { return c.close; }), 20);
  if (!atr || !ema20) return false;
  var recentCandles = candles.slice(-len);
  var avgVol = recentCandles.reduce(function(a, c) { return a + c.volume; }, 0) / len;
  var lastVol = recentCandles[recentCandles.length - 1].volume;
  var volRatio = lastVol / avgVol;
  return atr < getATR(candles.slice(-20), 14) * 0.8 && volRatio > 0.7;
}

function detectLiquiditySweep(candles, support, resistance) {
  if (!candles || candles.length < 3) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  var range = last.high - last.low;
  if (range === 0) return null;

  var upperWick = last.high - Math.max(last.open, last.close);
  var lowerWick = Math.min(last.open, last.close) - last.low;

  if (last.high > resistance && upperWick / range > 0.5 && last.close < resistance) {
    return { type: "SHORT", sweepType: "LIQUIDITY_SWEEP", zone: resistance };
  }
  if (last.low < support && lowerWick / range > 0.5 && last.close > support) {
    return { type: "LONG", sweepType: "LIQUIDITY_SWEEP", zone: support };
  }
  return null;
}

function detectEMACompression(candles) {
  if (!candles || candles.length < 20) return null;
  var ema5 = calcEMA(candles.map(function(c) { return c.close; }), 5);
  var ema10 = calcEMA(candles.map(function(c) { return c.close; }), 10);
  var ema20 = calcEMA(candles.map(function(c) { return c.close; }), 20);
  if (!ema5 || !ema10 || !ema20) return null;

  var spread5_10 = Math.abs(ema5 - ema10) / ema10;
  var spread10_20 = Math.abs(ema10 - ema20) / ema20;

  if (spread5_10 < 0.002 && spread10_20 < 0.003) {
    return { ema5: ema5, ema10: ema10, ema20: ema20 };
  }
  return null;
}

function detectMomentumBuildup(candles) {
  if (!candles || candles.length < 10) return null;
  var recent = candles.slice(-10);
  var volumes = recent.map(function(c) { return c.volume; });
  var avgVol = volumes.reduce(function(a, b) { return a + b; }, 0) / 10;
  var lastVol = recent[recent.length - 1].volume;

  var closes = recent.map(function(c) { return c.close; });
  var ema5 = calcEMA(closes, 5);
  var ema10 = calcEMA(closes, 10);
  if (!ema5 || !ema10) return null;

  if (lastVol > avgVol * 1.3 && ema5 > ema10 * 0.995) {
    return { type: "LONG", momentum: "BUILDING", ema5: ema5, ema10: ema10 };
  }
  if (lastVol > avgVol * 1.3 && ema5 < ema10 * 1.005) {
    return { type: "SHORT", momentum: "BUILDING", ema5: ema5, ema10: ema10 };
  }
  return null;
}

function detectMicroStructureShift(candles) {
  if (!candles || candles.length < 6) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  if (last.close > last.open && prev.close < prev.open) {
    var shiftCount = 0;
    for (var i = 2; i >= 0; i--) {
      var c = candles[candles.length - 1 - i];
      if (c.close < c.open) shiftCount++;
    }
    if (shiftCount >= 2) return { type: "LONG", shift: "BULL_SHIFT" };
  }
  if (last.close < last.open && prev.close > prev.open) {
    var shiftCount = 0;
    for (var i = 2; i >= 0; i--) {
      var c = candles[candles.length - 1 - i];
      if (c.close > c.open) shiftCount++;
    }
    if (shiftCount >= 2) return { type: "SHORT", shift: "BEAR_SHIFT" };
  }
  return null;
}

function detectMiniBOS(candles) {
  if (!candles || candles.length < 5) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  if (!last || !prev || !prev2) return null;

  if (last.high > prev.high && last.close > last.open) {
    return { type: "LONG", bosType: "MINI_BOS" };
  }
  if (last.low < prev.low && last.close < last.open) {
    return { type: "SHORT", bosType: "MINI_BOS" };
  }
  return null;
}

function detectEMAReclaim(candles) {
  if (!candles || candles.length < 5) return null;
  var ema10 = calcEMA(candles.map(function(c) { return c.close; }), 10);
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!ema10 || !last || !prev) return null;

  if (prev.close < ema10 && last.close > ema10 && last.close > last.open) {
    return { type: "LONG", reclaim: "ABOVE_EMA10" };
  }
  if (prev.close > ema10 && last.close < ema10 && last.close < last.open) {
    return { type: "SHORT", reclaim: "BELOW_EMA10" };
  }
  return null;
}

function detectOrderBlock(candles, direction) {
  if (!candles || candles.length < 10) return null;
  var recent = candles.slice(-10);
  if (direction === "LONG") {
    for (var i = recent.length - 1; i >= 0; i--) {
      var c = recent[i];
      if (c.close < c.open) {
        return { zone: [c.low, c.high], direction: "LONG", type: "ORDER_BLOCK" };
      }
    }
  } else {
    for (var i = recent.length - 1; i >= 0; i--) {
      var c = recent[i];
      if (c.close > c.open) {
        return { zone: [c.low, c.high], direction: "SHORT", type: "ORDER_BLOCK" };
      }
    }
  }
  return null;
}

function detectFVG(candles) {
  if (!candles || candles.length < 3) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  if (!last || !prev || !prev2) return null;

  if (prev2.high < last.low && last.close > last.open) {
    return { zone: [prev2.high, last.low], direction: "LONG", type: "FVG" };
  }
  if (prev2.low > last.high && last.close < last.open) {
    return { zone: [last.high, prev2.low], direction: "SHORT", type: "FVG" };
  }
  return null;
}

function detectBOS(candles) {
  if (!candles || candles.length < 5) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  var swingHigh = Math.max.apply(null, candles.slice(-10).map(function(c) { return c.high; }));
  var swingLow = Math.min.apply(null, candles.slice(-10).map(function(c) { return c.low; }));

  if (last.high > swingHigh && last.close < last.open) {
    return { type: "SHORT", bosType: "BOS", swingHigh: swingHigh };
  }
  if (last.low < swingLow && last.close > last.open) {
    return { type: "LONG", bosType: "BOS", swingLow: swingLow };
  }
  return null;
}

function calculateAIScore(ctx) {
  var s = 0;

  if (ctx.htfAlignment) s += 20;
  if (ctx.momentumStrength >= 80) s += 15;
  else if (ctx.momentumStrength >= 60) s += 10;
  else if (ctx.momentumStrength >= 40) s += 5;

  if (ctx.volumeExpansion > 1.5) s += 15;
  else if (ctx.volumeExpansion > 1.2) s += 10;
  else if (ctx.volumeExpansion > 1.0) s += 5;

  if (ctx.liquiditySweepQuality === "HIGH") s += 15;
  else if (ctx.liquiditySweepQuality === "MED") s += 10;
  else if (ctx.liquiditySweepQuality === "LOW") s += 5;

  if (ctx.structureQuality === "HIGH") s += 10;
  else if (ctx.structureQuality === "MED") s += 5;

  if (ctx.volatility > 0 && ctx.volatility < 50) s += 10;

  if (ctx.emaSlope > 0.01) s += 5;
  else if (ctx.emaSlope < -0.01) s += 5;

  if (ctx.rrQuality >= 2.0) s += 10;
  else if (ctx.rrQuality >= 1.5) s += 5;

  if (ctx.marketMode === MARKET_MODES.TRENDING) s += 5;
  else if (ctx.marketMode === MARKET_MODES.SIDEWAYS) s -= 5;

  return Math.max(0, Math.min(100, s));
}

function getConfidenceTier(score) {
  if (score >= CONFIDENCE_TIERS.ELITE) return "ELITE";
  if (score >= CONFIDENCE_TIERS.STRONG) return "STRONG";
  if (score >= CONFIDENCE_TIERS.VALID) return "VALID";
  return "WEAK";
}

function getSignalBadge(signalType) {
  switch (signalType) {
    case SIGNAL_TYPES.PRE_SNIPER: return "🟡 PREPARE";
    case SIGNAL_TYPES.SNIPER_SUPER: return "🔥 READY";
    case SIGNAL_TYPES.LTF_SNIPER: return "🚀 ENTRY";
    default: return "⚡ SIGNAL";
  }
}

function buildSignal(ctx) {
  var direction = ctx.direction;
  var entry = ctx.entry;
  var atr = ctx.atr;
  var marketMode = ctx.marketMode;

  var sl = null;
  var tp = null;

  if (direction === "LONG") {
    sl = round(entry - atr * LAB_CONFIG.atr_sl);
    tp = round(entry + atr * LAB_CONFIG.atr_tp);
  } else {
    sl = round(entry + atr * LAB_CONFIG.atr_sl);
    tp = round(entry - atr * LAB_CONFIG.atr_tp);
  }

  var rr = null;
  if (sl && tp && entry) {
    rr = round(Math.abs(tp - entry) / Math.abs(entry - sl));
  }

  var momentumStrength = ctx.momentumStrength || 50;
  var volumeExpansion = ctx.volumeExpansion || 1;
  var liquiditySweepQuality = ctx.liquiditySweepQuality || "LOW";
  var structureQuality = ctx.structureQuality || "MED";
  var volatility = ctx.volatility || 30;
  var emaSlope = ctx.emaSlope || 0;

  var aiScore = calculateAIScore({
    htfAlignment: ctx.htfAlignment,
    momentumStrength: momentumStrength,
    volumeExpansion: volumeExpansion,
    liquiditySweepQuality: liquiditySweepQuality,
    structureQuality: structureQuality,
    volatility: volatility,
    emaSlope: emaSlope,
    rrQuality: rr || 1,
    marketMode: marketMode
  });

  var tier = getConfidenceTier(aiScore);

  return {
    type: direction,
    direction: direction,
    signalType: ctx.signalType,
    entry: entry,
    tp: tp,
    sl: sl,
    rr: rr,
    aiScore: aiScore,
    confidenceTier: tier,
    status: ctx.status,
    entry: entry,
    reasons: ctx.reasons || [],
    atr: atr,
    support: ctx.support,
    resistance: ctx.resistance,
    ob: ctx.ob,
    fvg: ctx.fvg,
    bos: ctx.bos,
    marketMode: marketMode,
    signal_name: ctx.signalName || "AI SNIPER",
    predictedMove: rr ? (rr * atr).toFixed(4) : null,
    predictedMovePct: rr ? ((Math.abs(tp - entry) / entry) * 100).toFixed(2) : null
  };
}

function getLabSignal(data) {
  var candles5m = data.candles5m;
  var candles15m = data.candles15m;
  var support = data.support;
  var resistance = data.resistance;

  if (!candles5m || candles5m.length < 32 || !candles15m || candles15m.length < 32) {
    return null;
  }

  var c5 = candles5m[candles5m.length - 1];
  var prev5 = candles5m[candles5m.length - 2];
  var trend15m = getTrendBias(candles15m);
  var trend5m = getTrendBias(candles5m);
  var atr = getATR(candles5m);
  var marketMode = detectMarketMode(candles5m);

  if (!atr) return null;

  var signals = [];

  var liqSweep = detectLiquiditySweep(candles5m, support, resistance);
  var compression = detectCompression(candles5m);
  var volSqueeze = detectVolatilitySqueeze(candles5m);
  var emaComp = detectEMACompression(candles5m);
  var momBuildup = detectMomentumBuildup(candles5m);
  var microShift = detectMicroStructureShift(candles5m);
  var miniBOS = detectMiniBOS(candles5m);
  var emaReclaim = detectEMAReclaim(candles5m);
  var ob = detectOrderBlock(candles5m, "LONG");
  var fvg = detectFVG(candles5m);
  var bos = detectBOS(candles5m);

  var volumes = candles5m.slice(-10).map(function(c) { return c.volume; });
  var avgVol = volumes.reduce(function(a, b) { return a + b; }, 0) / 10;
  var lastVol = candles5m[candles5m.length - 1].volume;
  var volumeExpansion = lastVol / avgVol;

  var ema10 = calcEMA(candles5m.map(function(c) { return c.close; }), 10);
  var ema20 = calcEMA(candles5m.map(function(c) { return c.close; }), 20);
  var emaSlope = ema10 && ema20 ? (ema10 - ema20) / ema20 : 0;

  var momentumStrength = 50;
  if (momBuildup) momentumStrength += 20;
  if (volumeExpansion > 1.3) momentumStrength += 15;
  if (liqSweep) momentumStrength += 15;
  momentumStrength = Math.min(100, momentumStrength);

  if (liqSweep && compression && volumeExpansion > 0.9) {
    signals.push({
      signalType: SIGNAL_TYPES.PRE_SNIPER,
      direction: liqSweep.type,
      status: "PREPARE",
      signalName: "PRE SNIPER",
      reasons: ["liquidity_sweep", "compression_detected", "volume_anomaly"],
      htfAlignment: trend15m === liqSweep.type,
      momentumStrength: momentumStrength,
      volumeExpansion: volumeExpansion,
      liquiditySweepQuality: "HIGH",
      structureQuality: "HIGH",
      volatility: atr / c5.close * 100,
      emaSlope: emaSlope,
      ob: ob,
      fvg: fvg,
      bos: bos,
      marketMode: marketMode,
      entry: c5.close,
      atr: atr,
      support: support,
      resistance: resistance
    });
  }

  if (bos && fvg && ob) {
    var bosDir = bos.type;
    var obDir = ob.direction;
    var fvgDir = fvg.direction;
    if (bosDir === obDir && bosDir === fvgDir && bosDir === trend15m) {
      signals.push({
        signalType: SIGNAL_TYPES.SNIPER_SUPER,
        direction: bosDir,
        status: "READY",
        signalName: "SNIPER SUPER",
        reasons: ["bos_confirmed", "order_block", "fvq_confluence", "htf_aligned"],
        htfAlignment: true,
        momentumStrength: momentumStrength + 20,
        volumeExpansion: volumeExpansion,
        liquiditySweepQuality: liqSweep ? "HIGH" : "MED",
        structureQuality: "HIGH",
        volatility: atr / c5.close * 100,
        emaSlope: emaSlope,
        ob: ob,
        fvg: fvg,
        bos: bos,
        marketMode: marketMode,
        entry: c5.close,
        atr: atr,
        support: support,
        resistance: resistance
      });
    }
  }

  if (miniBOS && emaReclaim && trend15m === miniBOS.type) {
    signals.push({
      signalType: SIGNAL_TYPES.LTF_SNIPER,
      direction: miniBOS.type,
      status: "ENTRY",
      signalName: "LTF ENTRY",
      reasons: ["mini_bos", "ema_reclaim", "momentum_accel"],
      htfAlignment: trend15m === miniBOS.type,
      momentumStrength: momentumStrength + 10,
      volumeExpansion: volumeExpansion,
      liquiditySweepQuality: liqSweep ? "MED" : "LOW",
      structureQuality: "MED",
      volatility: atr / c5.close * 100,
      emaSlope: emaSlope,
      ob: ob,
      fvg: fvg,
      bos: bos,
      marketMode: marketMode,
      entry: c5.close,
      atr: atr,
      support: support,
      resistance: resistance
    });
  }

  if (momBuildup && volumeExpansion > 1.2) {
    signals.push({
      signalType: SIGNAL_TYPES.MOMENTUM_BREAK,
      direction: momBuildup.type,
      status: "ENTRY",
      signalName: "MOMENTUM BREAK",
      reasons: ["momentum_buildup", "volume_expansion"],
      htfAlignment: trend15m === momBuildup.type,
      momentumStrength: momentumStrength + 15,
      volumeExpansion: volumeExpansion,
      liquiditySweepQuality: liqSweep ? "MED" : "LOW",
      structureQuality: "MED",
      volatility: atr / c5.close * 100,
      emaSlope: emaSlope,
      ob: ob,
      fvg: fvg,
      bos: bos,
      marketMode: marketMode,
      entry: c5.close,
      atr: atr,
      support: support,
      resistance: resistance
    });
  }

  if (signals.length === 0) {
    if (bullishRejection(c5) && trend15m === "LONG") {
      signals.push({
        signalType: SIGNAL_TYPES.PRE_SNIPER,
        direction: "LONG",
        status: "PREPARE",
        signalName: "PRE SNIPER",
        reasons: ["bullish_rejection", "trend_alignment"],
        htfAlignment: trend15m === "LONG",
        momentumStrength: momentumStrength,
        volumeExpansion: volumeExpansion,
        liquiditySweepQuality: "MED",
        structureQuality: "MED",
        volatility: atr / c5.close * 100,
        emaSlope: emaSlope,
        ob: ob,
        fvg: fvg,
        bos: bos,
        marketMode: marketMode,
        entry: c5.close,
        atr: atr,
        support: support,
        resistance: resistance
      });
    }
    if (bearishRejection(c5) && trend15m === "SHORT") {
      signals.push({
        signalType: SIGNAL_TYPES.PRE_SNIPER,
        direction: "SHORT",
        status: "PREPARE",
        signalName: "PRE SNIPER",
        reasons: ["bearish_rejection", "trend_alignment"],
        htfAlignment: trend15m === "SHORT",
        momentumStrength: momentumStrength,
        volumeExpansion: volumeExpansion,
        liquiditySweepQuality: "MED",
        structureQuality: "MED",
        volatility: atr / c5.close * 100,
        emaSlope: emaSlope,
        ob: ob,
        fvg: fvg,
        bos: bos,
        marketMode: marketMode,
        entry: c5.close,
        atr: atr,
        support: support,
        resistance: resistance
      });
    }
  }

  if (signals.length === 0) {
    return null;
  }

  signals.sort(function(a, b) {
    if (PRIORITY[a.signalType] !== PRIORITY[b.signalType]) {
      return PRIORITY[a.signalType] - PRIORITY[b.signalType];
    }
    return b.aiScore - a.aiScore;
  });

  var best = signals[0];
  var aiScore = calculateAIScore({
    htfAlignment: best.htfAlignment,
    momentumStrength: best.momentumStrength,
    volumeExpansion: best.volumeExpansion,
    liquiditySweepQuality: best.liquiditySweepQuality,
    structureQuality: best.structureQuality,
    volatility: best.volatility,
    emaSlope: best.emaSlope,
    rrQuality: 1.5,
    marketMode: best.marketMode
  });

  if (aiScore < 40) {
    return null;
  }

  var rr = null;
  var sl = best.direction === "LONG"
    ? round(c5.close - atr * LAB_CONFIG.atr_sl)
    : round(c5.close + atr * LAB_CONFIG.atr_sl);
  var tp = best.direction === "LONG"
    ? round(c5.close + atr * LAB_CONFIG.atr_tp)
    : round(c5.close - atr * LAB_CONFIG.atr_tp);

  if (sl && tp && c5.close) {
    rr = round(Math.abs(tp - c5.close) / Math.abs(c5.close - sl));
  }

  if (rr !== null && rr < 1.0) {
    return null;
  }

  var entry = c5.close;

  return {
    type: best.direction,
    direction: best.direction,
    signalType: best.signalType,
    signalName: best.signalName,
    status: best.status,
    entry: entry,
    tp: tp,
    sl: sl,
    rr: rr,
    aiScore: aiScore,
    confidenceTier: getConfidenceTier(aiScore),
    reasons: best.reasons,
    atr: atr,
    support: support,
    resistance: resistance,
    ob: best.ob,
    fvg: best.fvg,
    bos: best.bos,
    marketMode: best.marketMode,
    trend15m: trend15m,
    trend5m: trend5m,
    score: aiScore,
    score_long: best.direction === "LONG" ? aiScore : 0,
    score_short: best.direction === "SHORT" ? aiScore : 0,
    predictedMove: rr ? (rr * atr).toFixed(4) : null,
    predictedMovePct: rr ? ((Math.abs(tp - entry) / entry) * 100).toFixed(2) : null
  };
}

function buildLabCard(signal) {
  if (!signal) return null;
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
    trend: signal.trend15m,
    mode: signal.marketMode || "CHOPPY",
    reason: signal.reasons ? signal.reasons.join(", ") : signal.signal_name,
    status: signal.status,
    signal_name: signal.signal_name,
    atr: signal.atr,
    support: signal.support,
    resistance: signal.resistance,
    ob: signal.ob,
    fvg: signal.fvg,
    bos: signal.bos,
    predictedMove: signal.predictedMove,
    predictedMovePct: signal.predictedMovePct,
    aiPanel: {
      direction: signal.direction,
      aiScore: signal.aiScore,
      confidenceTier: signal.confidenceTier,
      marketMode: signal.marketMode,
      predictedMove: signal.predictedMovePct,
      signalType: signal.signalType,
      signalName: signal.signalName
    },
    candle: null
  };
}

function calculatePositionSize(entry, sl, balance) {
  if (!entry || !sl || !balance) return 0;
  var riskCapital = balance * LAB_CONFIG.risk_per_trade;
  var riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit === 0) return 0;
  return round(riskCapital / riskPerUnit, 2);
}

function updateTrailingStop(position, currentPrice) {
  if (!position || !currentPrice) return position;
  var atr = position.atr || getATR([{high: currentPrice, low: currentPrice, close: currentPrice}], 14);
  if (!atr) return position;

  if (position.side === "LONG") {
    var profit = currentPrice - position.entry;
    if (profit > atr * LAB_CONFIG.trailing_trigger) {
      var newSL = round(currentPrice - atr * LAB_CONFIG.trailing_distance);
      if (newSL > position.sl) {
        position.sl = newSL;
      }
    }
  }
  if (position.side === "SHORT") {
    var profit = position.entry - currentPrice;
    if (profit > atr * LAB_CONFIG.trailing_trigger) {
      var newSL = round(currentPrice + atr * LAB_CONFIG.trailing_distance);
      if (newSL < position.sl) {
        position.sl = newSL;
      }
    }
  }
  return position;
}

module.exports = {
  LAB_CONFIG: LAB_CONFIG,
  SIGNAL_TYPES: SIGNAL_TYPES,
  PRIORITY: PRIORITY,
  CONFIDENCE_TIERS: CONFIDENCE_TIERS,
  MARKET_MODES: MARKET_MODES,
  getTrendBias: getTrendBias,
  getATR: getATR,
  getLabSignal: getLabSignal,
  buildLabCard: buildLabCard,
  calculatePositionSize: calculatePositionSize,
  updateTrailingStop: updateTrailingStop,
  isStrongBull: isStrongBull,
  isStrongBear: isStrongBear,
  bullishRejection: bullishRejection,
  bearishRejection: bearishRejection,
  volumeSpike: volumeSpike,
  fakeBreakoutShort: fakeBreakoutShort,
  fakeBreakoutLong: fakeBreakoutLong,
  detectCompression: detectCompression,
  detectVolatilitySqueeze: detectVolatilitySqueeze,
  detectLiquiditySweep: detectLiquiditySweep,
  detectEMACompression: detectEMACompression,
  detectMomentumBuildup: detectMomentumBuildup,
  detectMicroStructureShift: detectMicroStructureShift,
  detectMiniBOS: detectMiniBOS,
  detectEMAReclaim: detectEMAReclaim,
  detectOrderBlock: detectOrderBlock,
  detectFVG: detectFVG,
  detectBOS: detectBOS,
  calculateAIScore: calculateAIScore,
  getConfidenceTier: getConfidenceTier,
  getSignalBadge: getSignalBadge
};