// ── ELITE QUANT SNIPER AI ─────────────────────────────────────────────
// Advanced sniper engine: liquidity manipulation, smart money, high-probability entries
// Quality over quantity. Elite institutional logic.

const ROUND_DEC = 2;
const round = (v, d = ROUND_DEC) => v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

// ══════════════════════════════════════════════════════════
// CORE SNIPER DETECTORS
// ══════════════════════════════════════════════════════════

// ── Detect Equal Highs / Equal Lows (Liquidity Pools) ──────
function detectEqualHighs(highs, tolerancePct = 0.0015) {
  if (!highs || highs.length < 2) return null;
  const last = highs[highs.length - 1];
  const prev = highs[highs.length - 2];
  if (Math.abs(last - prev) / last < tolerancePct) {
    return { type: "EQUAL_HIGHS", price: last, prev: prev };
  }
  return null;
}

function detectEqualLows(lows, tolerancePct = 0.0015) {
  if (!lows || lows.length < 2) return null;
  const last = lows[lows.length - 1];
  const prev = lows[lows.length - 2];
  if (Math.abs(last - prev) / last < tolerancePct) {
    return { type: "EQUAL_LOWS", price: last, prev: prev };
  }
  return null;
}

// ── Liquidity Sweep Detection (Stop Hunt) ──────────────────
function detectLiquiditySweep(candles) {
  if (!candles || candles.length < 5) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  const range = last.high - last.low;
  if (range === 0) return null;

  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const upperPct = upperWick / range;
  const lowerPct = lowerWick / range;
  const body = Math.abs(last.close - last.open);
  const bodyPct = body / range;

  // Bull trap: sweep above highs, close below
  if (last.high > prev.high && last.close < prev.high && upperPct > 0.35 && bodyPct < 0.45) {
    return {
      type: "LIQUIDITY_SWEEP",
      direction: "SHORT",
      swept: "BUY_SIDE_LIQUIDITY",
      reason: "buy-side liquidity swept — seller takeover",
      entry: last.close,
      sl: last.high * 1.0007,
      strength: upperPct > 0.55 ? "STRONG" : "MODERATE"
    };
  }

  // Bear trap: sweep below lows, close above
  if (last.low < prev.low && last.close > prev.low && lowerPct > 0.35 && bodyPct < 0.45) {
    return {
      type: "LIQUIDITY_SWEEP",
      direction: "LONG",
      swept: "SELL_SIDE_LIQUIDITY",
      reason: "sell-side liquidity swept — buyer takeover",
      entry: last.close,
      sl: last.low * 0.9993,
      strength: lowerPct > 0.55 ? "STRONG" : "MODERATE"
    };
  }

  return null;
}

// ── Fair Value Gap (FVG) Detection ──────────────────────────
function detectFVG(candles) {
  if (!candles || candles.length < 3) return null;
  const t1 = candles[candles.length - 3];
  const t2 = candles[candles.length - 2];
  const t3 = candles[candles.length - 1];
  if (!t1 || !t2 || !t3) return null;

  // Bullish FVG: gap between t1 high and t3 low
  if (t3.low > t1.high) {
    const zoneMid = (t3.low + t1.high) / 2;
    return {
      type: "FVG",
      direction: "LONG",
      zone: [t1.high, t3.low],
      midpoint: zoneMid,
      reason: "bullish FVG detected — liquidity grab",
      penetration: false
    };
  }

  // Bearish FVG: gap between t3 high and t1 low
  if (t1.low > t3.high) {
    const zoneMid = (t1.low + t3.high) / 2;
    return {
      type: "FVG",
      direction: "SHORT",
      zone: [t3.high, t1.low],
      midpoint: zoneMid,
      reason: "bearish FVG detected — liquidity grab",
      penetration: false
    };
  }

  return null;
}

// ── Order Block Detection (Smart Money Supply/Demand) ──────
function detectOrderBlock(candles) {
  if (!candles || candles.length < 5) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const range = last.high - last.low;
  if (range === 0) return null;

  const body = Math.abs(last.close - last.open);
  const bodyPct = body / range;

  // Bullish OB: last 2-3 candles bearish, last candle bullish
  if (prev && prev.close < prev.open && last.close > last.open && bodyPct > 0.5) {
    return {
      type: "OB",
      direction: "LONG",
      zone: [prev.low, last.low],
      entry: last.close,
      reason: "bullish order block — smart money support",
      quality: bodyPct > 0.7 ? "HIGH" : "MEDIUM"
    };
  }

  // Bearish OB: last 2-3 candles bullish, last candle bearish
  if (prev && prev.close > prev.open && last.close < last.open && bodyPct > 0.5) {
    return {
      type: "OB",
      direction: "SHORT",
      zone: [last.high, prev.high],
      entry: last.close,
      reason: "bearish order block — smart money resistance",
      quality: bodyPct > 0.7 ? "HIGH" : "MEDIUM"
    };
  }

  return null;
}

// ── Break of Structure (BOS) Detection ───────────────────
function detectBOS(candles, structure) {
  if (!candles || candles.length < 10) return null;
  if (!structure || structure === "NA") return null;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // Recent highs/lows
  const recentH = highs.slice(-5);
  const recentL = lows.slice(-5);
  const priorH = highs.slice(-10, -5);
  const priorL = lows.slice(-10, -5);

  const maxRH = Math.max(...recentH);
  const maxRL = Math.min(...recentL);
  const maxPH = Math.max(...priorH);
  const maxPL = Math.min(...priorL);

  // Bullish BOS: higher highs + higher lows vs prior
  if (structure === "HH" || structure === "HL") {
    if (maxRH > maxPH) {
      return {
        type: "BOS",
        direction: "LONG",
        breakLevel: maxPH,
        reason: "bullish BOS confirmed — structure broken",
        confirmed: true
      };
    }
  }

  // Bearish BOS: lower highs + lower lows vs prior
  if (structure === "LL" || structure === "LH") {
    if (maxRL < maxPL) {
      return {
        type: "BOS",
        direction: "SHORT",
        breakLevel: maxPL,
        reason: "bearish BOS confirmed — structure broken",
        confirmed: true
      };
    }
  }

  return null;
}

// ── Change of Character (CHoCH) Detection ─────────────────
function detectCHoCH(candles, prevStructure) {
  if (!candles || candles.length < 10 || !prevStructure) return null;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const recentH = highs.slice(-5);
  const recentL = lows.slice(-5);
  const priorH = highs.slice(-10, -5);
  const priorL = lows.slice(-10, -5);

  const maxRH = Math.max(...recentH);
  const maxRL = Math.min(...recentL);

  // Bullish CHoCH: LL breaks prior low range
  if ((prevStructure === "LL" || prevStructure === "LH") && maxRL < Math.min(...priorL)) {
    return {
      type: "CHOCH",
      direction: "LONG",
      reason: "change of character — bullish shift",
      confirmed: true
    };
  }

  // Bearish CHoCH: LH breaks prior high range
  if ((prevStructure === "HH" || prevStructure === "HL") && maxRH > Math.max(...priorH)) {
    return {
      type: "CHOCH",
      direction: "SHORT",
      reason: "change of character — bearish shift",
      confirmed: true
    };
  }

  return null;
}

// ── Momentum Filter (Volume + ATR) ──────────────────────
function detectMomentum(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  const volumes = candles.slice(-period).map(c => c.volume || 0);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVol = volumes[volumes.length - 1];

  const ranges = candles.slice(-period).map(c => c.high - c.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const lastRange = ranges[ranges.length - 1];

  // Volume spike detection
  const volSpike = lastVol > avgVol * 1.5;

  // ATR expansion detection
  const atrExpansion = lastRange > avgRange * 1.3;

  // High momentum candles
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const bodyPct = lastRange > 0 ? body / lastRange : 0;
  const strongCandle = bodyPct > 0.65;

  return {
    volume_spike: volSpike,
    atr_expansion: atrExpansion,
    strong_candle: strongCandle,
    avg_volume: avgVol,
    last_volume: lastVol,
    vol_ratio: lastVol / (avgVol || 1),
    strength: volSpike && atrExpansion ? "HIGH" : volSpike || atrExpansion ? "MEDIUM" : "LOW"
  };
}

// ══════════════════════════════════════════════════════════
// ELITE CONFIDENCE SCORING SYSTEM
// ══════════════════════════════════════════════════════════

function computeEliteScore(context) {
  let score = 0;
  const reasons = [];

  // ── HTF Trend Alignment (+2) ──────────────────────────
  if (context.htf_bullish && context.direction === "LONG") {
    score += 2; reasons.push("HTF Bullish");
  }
  if (context.htf_bearish && context.direction === "SHORT") {
    score += 2; reasons.push("HTF Bearish");
  }

  // ── Liquidity Sweep (+3) ────────────────────────────────
  if (context.liquiditySweep && context.liquiditySweep.direction === context.direction) {
    score += 3;
    reasons.push("Liquidity Sweep " + context.liquiditySweep.strength);
  }

  // ── BOS Confirmation (+2) ──────────────────────────────
  if (context.bos && context.bos.direction === context.direction) {
    score += 2; reasons.push("BOS Confirmed");
  }

  // ── FVG Retest (+1) ───────────────────────────────────
  if (context.fvg && context.fvg.direction === context.direction) {
    score += 1; reasons.push("FVG Retest");
  }

  // ── Volume Spike (+1) ────────────────────────────────
  if (context.momentum && context.momentum.volume_spike) {
    score += 1; reasons.push("Volume Spike");
  }

  // ── Order Block Confluence (+1) ───────────────────────
  if (context.ob && context.ob.direction === context.direction) {
    score += 1; reasons.push("OB Confluence");
  }

  // ── CHoCH Confirmation (+1) ────────────────────────────
  if (context.choch && context.choch.direction === context.direction) {
    score += 1; reasons.push("CHoCH");
  }

  return { score, reasons, grade: scoreToGrade(score) };
}

function scoreToGrade(score) {
  if (score >= 9) return "ELITE SNIPER";
  if (score >= 7) return "STRONG";
  if (score >= 5) return "MODERATE";
  return "WEAK";
}

// ══════════════════════════════════════════════════════════
// SNIPER ENTRY BUILDER
// ══════════════════════════════════════════════════════════

function buildSniperEntry(context, candles) {
  const last = candles[candles.length - 1];
  const price = last.close;

  if (!context.direction || context.direction === "WAIT") return null;

  // Calculate entry zone based on FVG or OB
  let entryZone = null;
  if (context.fvg && context.fvg.direction === context.direction) {
    entryZone = context.fvg.zone;
  } else if (context.ob && context.ob.direction === context.direction) {
    entryZone = context.ob.zone;
  }

  // Calculate SL (stop below sweep low for LONG, above sweep high for SHORT)
  let sl = null;
  if (context.direction === "LONG") {
    sl = context.liquiditySweep && context.liquiditySweep.swept === "SELL_SIDE_LIQUIDITY"
      ? context.liquiditySweep.sl
      : price - (context.atr || 80) * 0.8;
  } else {
    sl = context.liquiditySweep && context.liquiditySweep.swept === "BUY_SIDE_LIQUIDITY"
      ? context.liquiditySweep.sl
      : price + (context.atr || 80) * 0.8;
  }

  // Calculate TP (next liquidity zone)
  const range = context.resistance - context.support;
  let tp = null;
  if (context.direction === "LONG") {
    tp = context.resistance - range * 0.15; // Near resistance
  } else {
    tp = context.support + range * 0.15; // Near support
  }

  // Entry price selection
  const entry = entryZone
    ? (context.direction === "LONG" ? entryZone[0] : entryZone[1])
    : price;

  // RR calculation
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);

  // Check minimum RR requirement
  if (rr < 2.0) return null;

  return {
    name: "ELITE SNIPER",
    type: context.direction,
    entry: round(entry),
    tp: round(tp),
    sl: round(sl),
    rr: round(rr, 1),
    score: context.scoreResult.score,
    confidence: context.scoreResult.grade,
    reasons: context.scoreResult.reasons,
    status: context.scoreResult.score >= 7 ? "ACTIVE" : "WAIT",
    entry_zone: entryZone,
    candle: last,
    momentum: context.momentum,
    fvg: context.fvg,
    ob: context.ob,
    bos: context.bos,
    liquiditySweep: context.liquiditySweep
  };
}

// ══════════════════════════════════════════════════════════
// MAIN SNIPER SIGNAL BUILDER (server.js uses legacy 2-arg signature)
// ══════════════════════════════════════════════════════════

function buildSniperSignal(context, candles) {
  return buildSniperSignalLegacy(context, candles);
}

  if (!candles || candles.length < 20 || !payload) return null;

  const price = payload.close || candles[candles.length - 1].close;
  const ema20 = payload.ema20;
  const ema50 = payload.ema50;
  const ema200 = payload.ema200;
  const rsi = payload.rsi || 50;
  const support = payload.support;
  const resistance = payload.resistance;

  // ── Run all detectors ─────────────────────────────────
  const liqSweep = detectLiquiditySweep(candles);
  const fvg = detectFVG(candles);
  const ob = detectOrderBlock(candles);
  const bos = detectBOS(candles, structure);
  const choch = detectCHoCH(candles, payload.prevStructure);
  const mom = detectMomentum(candles);

  // ── Determine HTF Bias ────────────────────────────────
  let htf_dir = htfBias || "NEUTRAL";
  if (htf_dir === "NEUTRAL" && ema20 && ema50 && ema200) {
    if (ema20 > ema50 && ema50 > ema200) htf_dir = "LONG";
    else if (ema20 < ema50 && ema50 < ema200) htf_dir = "SHORT";
  }

  // ── Determine Direction from Structure ───────────────
  let direction = "WAIT";

  // CHoCH first priority (change of character)
  if (choch && choch.confirmed) {
    direction = choch.direction;
  }
  // BOS second priority
  else if (bos && bos.confirmed) {
    direction = bos.direction;
  }
  // Liquidity sweep third priority
  else if (liqSweep) {
    direction = liqSweep.direction;
  }
  // HTF bias as fallback
  else if (htf_dir !== "NEUTRAL") {
    direction = htf_dir;
  }

  // Reject counter-trend signals
  if (direction !== "WAIT" && htf_dir !== "NEUTRAL" && direction !== htf_dir) {
    return null; // HTF conflict — wait
  }

  if (direction === "WAIT") return null;

  // ── Volatility Filter (avoid low vol) ────────────────
  if (mom && mom.strength === "LOW") {
    // Check ATR
    const atr = (payload.high - payload.low) * 0.02;
    if (atr < 30) return null; // Too low volatility
  }

  // ── RSI Filter (avoid overbought/oversold for entries) ─
  if (direction === "LONG" && rsi > 75) return null;
  if (direction === "SHORT" && rsi < 25) return null;

  // ── Build context ───────────────────────────────────
  const context = {
    direction,
    htf_bullish: htf_dir === "LONG",
    htf_bearish: htf_dir === "SHORT",
    liquiditySweep: liqSweep,
    fvg,
    ob,
    bos,
    choch,
    momentum: mom,
    atr: (payload.high - payload.low) * 0.02,
    rsi,
    support,
    resistance,
    structure
  };

  // ── Compute Elite Score ───────────────────────────────
  const scoreResult = computeEliteScore(context);
  context.scoreResult = scoreResult;

  // ── Minimum score threshold ─────────────────────────
  if (scoreResult.score < 7) return null;

  // ── Build Sniper Entry ───────────────────────────────
  const sniperEntry = buildSniperEntry(context, candles);
  if (!sniperEntry) return null;

  // Calculate market condition
  const expPhase = mom && mom.strength === "HIGH" && scoreResult.score >= 7;
  sniperEntry.market_condition = expPhase ? "EXPANSION" : "NORMAL";

  return sniperEntry;
}

// ══════════════════════════════════════════════════════════
// ANTI-FAKEOUT SYSTEM
// ══════════════════════════════════════════════════════════

function isFakeout(candle, prevHigh, prevLow) {
  if (!candle) return false;
  const range = candle.high - candle.low;
  if (range === 0) return false;

  const body = Math.abs(candle.close - candle.open);
  const bodyPct = body / range;

  // Strong rejection after breakout attempt
  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;
  const upperPct = upperWick / range;
  const lowerPct = lowerWick / range;

  // Fakeout patterns
  // 1. Break high but close below (bull trap)
  if (candle.high > prevHigh && candle.close < prevHigh && upperPct > 0.4 && bodyPct < 0.4) {
    return { type: "BULL_TRAP", direction: "SHORT" };
  }
  // 2. Break low but close above (bear trap)
  if (candle.low < prevLow && candle.close > prevLow && lowerPct > 0.4 && bodyPct < 0.4) {
    return { type: "BEAR_TRAP", direction: "LONG" };
  }

  return false;
}

// ── Engulfing Detector ─────────────────────────────────────
function detectEngulfing(prev, curr) {
  if (!prev || !curr) return null;

  const bullish =
    curr.close > curr.open &&
    prev.close < prev.open &&
    curr.close > prev.open &&
    curr.open < prev.close;

  const bearish =
    curr.close < curr.open &&
    prev.close > prev.open &&
    curr.open > prev.close &&
    curr.close < prev.open;

  if (bullish) return { type: "LONG", strength: "ENGULFING" };
  if (bearish) return { type: "SHORT", strength: "ENGULFING" };

  return null;
}

// ── Fake Breakout Detector ────────────────────────────────
function detectFakeBreakout(candles) {
  if (!candles || candles.length < 5) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  if (last.high > prev.high && last.close < prev.high) {
    return { type: "FAKE_BREAKOUT", direction: "SHORT", reason: "break high rejection" };
  }
  if (last.low < prev.low && last.close > prev.low) {
    return { type: "FAKE_BREAKOUT", direction: "LONG", reason: "break low rejection" };
  }
  return null;
}

// ── Near Zone Check ──────────────────────────────────────
function nearZone(price, zone, tolPct = 0.002) {
  if (!zone) return false;
  const arr = Array.isArray(zone) ? zone : [zone, zone];
  const low = arr[0], high = arr[1];
  const mid = (low + high) / 2;
  return Math.abs(price - mid) / mid <= tolPct;
}

// ── Confidence Score (legacy compatibility) ───────────────
function scoreConfidence(ctx) {
  let s = 0;
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

// ── Color Mapping ─────────────────────────────────────────
function mapColor(score) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

// ── DCA Builder ───────────────────────────────────────────
function buildDCA(signal) {
  if (!signal || !signal.entry || !signal.sl || !signal.type) return null;
  const diff = Math.abs(signal.entry - signal.sl);
  const step = diff * 0.3;
  return [
    { price: signal.entry, size: 0.4 },
    { price: signal.type === "LONG" ? signal.entry - step : signal.entry + step, size: 0.3 },
    { price: signal.type === "LONG" ? signal.entry - step * 2 : signal.entry + step * 2, size: 0.3 }
  ];
}

// ── Legacy buildSniperSignal (enhanced) ───────────────────
function buildSniperSignalLegacy(context, candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  const engulf = detectEngulfing(prev, last);
  const fake = detectFakeBreakout(candles);
  const ob = context.ob;
  const fvg = context.fvg;
  const smc = context.smc;
  const structure = context.structure;
  const htf = context.htf_bias;
  const price = last.close;

  let dir = null;
  let score = 0;
  const reasons = [];
  const nearOB = ob && nearZone(price, ob.zone);
  const nearFVG = fvg && nearZone(price, fvg.zone);

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

  const confScore = scoreConfidence({
    engulfing: !!engulf,
    fakeBreakout: !!fake,
    htf_bias: htf,
    dir: dir,
    ob: { hit: !!(ob && ob.direction === dir && nearOB) },
    fvg: { hit: !!(fvg && fvg.direction === dir && nearFVG) },
    smc: { confirm: !!(smc && smc.direction === dir) },
    market: context.market || {}
  });

  const entry = price;
  const tp = dir === "LONG" ? price + 150 : price - 150;
  const sl = dir === "LONG" ? price - 80 : price + 80;

  const signal = {
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

// ── Zone Helper ──────────────────────────────────────────
function getPremiumZone(support, resistance) {
  const range = resistance - support;
  const mid = (support + resistance) / 2;
  return {
    premium_short: [resistance - range * 0.1, resistance],
    premium_long: [support, support + range * 0.1],
    fair_value: mid,
    discount_short: [support + range * 0.1, support + range * 0.3],
    discount_long: [resistance - range * 0.3, resistance - range * 0.1]
  };
}

// ── ATR Calculator ────────────────────────────────────────
function calcATR(candles, period = 14) {
  if (!candles || candles.length < period) return null;
  const ranges = candles.slice(-period).map(c => c.high - c.low);
  return ranges.reduce((a, b) => a + b, 0) / period;
}

// ── Detect Equal Highs/Lows for Liquidity ─────────────────
function detectLiquidityPools(candles, left = 5, right = 5) {
  const highs = [];
  const lows = [];

  for (let i = left; i < candles.length - right; i++) {
    const slice = candles.slice(i - left, i + right + 1);
    const isHigh = slice.every(c => candles[i].high >= c.high);
    const isLow = slice.every(c => candles[i].low <= c.low);
    if (isHigh) highs.push({ price: candles[i].high, index: i });
    if (isLow) lows.push({ price: candles[i].low, index: i });
  }

  return {
    equalHighs: detectEqualHighs(highs.map(h => h.price)),
    equalLows: detectEqualLows(lows.map(l => l.price)),
    recentHighs: highs.slice(-3),
    recentLows: lows.slice(-3)
  };
}

module.exports = {
  buildSniperSignal,
  buildSniperSignalLegacy,
  detectEngulfing,
  detectFakeBreakout,
  detectLiquiditySweep,
  detectFVG,
  detectOrderBlock,
  detectBOS,
  detectCHoCH,
  detectMomentum,
  computeEliteScore,
  scoreToGrade,
  isFakeout,
  nearZone,
  scoreConfidence,
  mapColor,
  buildDCA,
  detectLiquidityPools,
  getPremiumZone,
  calcATR
};