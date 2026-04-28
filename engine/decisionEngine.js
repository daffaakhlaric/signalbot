const round = (v, d = 2) =>
  v == null || isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

function getPivots(data, left = 3, right = 3) {
  const pivots = [];
  for (let i = left; i < data.length - right; i++) {
    const slice = data.slice(i - left, i + right + 1);
    const isHigh = slice.every(c => data[i].high >= c.high);
    const isLow  = slice.every(c => data[i].low <= c.low);
    if (isHigh) pivots.push({ type: "HIGH", price: data[i].high, index: i });
    if (isLow)  pivots.push({ type: "LOW",  price: data[i].low,  index: i });
  }
  return pivots;
}

function detectDoubleTop(candles) {
  const pivots = getPivots(candles);
  const highs = pivots.filter(p => p.type === "HIGH");
  if (highs.length < 2) return null;

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const tolerance = h2.price * 0.003;
  if (Math.abs(h1.price - h2.price) > tolerance) return null;

  const necklineCand = pivots.filter(p => p.type === "LOW" && p.index > h1.index && p.index < h2.index);
  if (!necklineCand.length) return null;
  const neckline = necklineCand.reduce((a, b) => a.price < b.price ? a : b);

  const last = candles[candles.length - 1];
  const breakConfirmed = last.close >= neckline.price;

  const entry = last.close;
  const height = h2.price - neckline.price;
  const tp = entry - height;
  const sl = h2.price * 1.0007;
  const rr = Math.abs(entry - tp) / Math.abs(sl - entry);

  return {
    type: "DOUBLE_TOP",
    direction: "SHORT",
    status: breakConfirmed ? "ENTRY" : "PLAN",
    neckline: neckline.price,
    entry: round(entry, 2),
    tp: round(tp, 2),
    sl: round(sl, 2),
    rr: round(rr, 2),
    confidence: 0.85,
    reason: breakConfirmed ? "neckline break confirmed" : `waiting neckline break @ ${round(neckline.price, 2)}`,
  };
}

function detectDoubleBottom(candles) {
  const pivots = getPivots(candles);
  const lows = pivots.filter(p => p.type === "LOW");
  if (lows.length < 2) return null;

  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  const tolerance = l2.price * 0.003;
  if (Math.abs(l1.price - l2.price) > tolerance) return null;

  const necklineCand = pivots.filter(p => p.type === "HIGH" && p.index > l1.index && p.index < l2.index);
  if (!necklineCand.length) return null;
  const neckline = necklineCand.reduce((a, b) => a.price > b.price ? a : b);

  const last = candles[candles.length - 1];
  const breakConfirmed = last.close <= neckline.price;

  const entry = last.close;
  const height = neckline.price - l2.price;
  const tp = entry + height;
  const sl = l2.price * 0.9993;
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);

  return {
    type: "DOUBLE_BOTTOM",
    direction: "LONG",
    status: breakConfirmed ? "ENTRY" : "PLAN",
    neckline: neckline.price,
    entry: round(entry, 2),
    tp: round(tp, 2),
    sl: round(sl, 2),
    rr: round(rr, 2),
    confidence: 0.85,
    reason: breakConfirmed ? "neckline break confirmed" : `waiting neckline break @ ${round(neckline.price, 2)}`,
  };
}

function detectTriangle(candles) {
  const pivots = getPivots(candles);
  const highs = pivots.filter(p => p.type === "HIGH").slice(-3);
  const lows  = pivots.filter(p => p.type === "LOW").slice(-3);
  if (highs.length < 2 || lows.length < 2) return null;

  const descHighs = highs[0].price > highs[highs.length - 1].price;
  const ascLows   = lows[0].price < lows[lows.length - 1].price;
  if (!(descHighs && ascLows)) return null;

  const upper = highs[highs.length - 1].price;
  const lower = lows[lows.length - 1].price;
  const last  = candles[candles.length - 1];

  if (last.close > upper) {
    return {
      type: "TRIANGLE_UP",
      direction: "LONG",
      status: "ENTRY",
      entry: round(last.close, 2),
      tp: round(last.close + (upper - lower), 2),
      sl: round(lower, 2),
      rr: 2,
      confidence: 0.75,
      reason: "triangle breakout upside",
    };
  }
  if (last.close < lower) {
    return {
      type: "TRIANGLE_DOWN",
      direction: "SHORT",
      status: "ENTRY",
      entry: round(last.close, 2),
      tp: round(last.close - (upper - lower), 2),
      sl: round(upper, 2),
      rr: 2,
      confidence: 0.75,
      reason: "triangle breakout downside",
    };
  }
  return {
    type: "TRIANGLE",
    direction: "NEUTRAL",
    status: "PLAN",
    reason: "waiting triangle breakout",
    confidence: 0.5,
  };
}

function isConfirmationCandle(candles, dir) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return false;

  const body    = Math.abs(last.close - last.open);
  const range   = last.high - last.low;
  if (range === 0) return false;
  const bodyPct  = body / range;
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const upperPct = upperWick / range;
  const lowerPct = lowerWick / range;

  if (dir === "LONG") {
    return (lowerPct > 0.3 && bodyPct < 0.65 && last.close > last.open) ||
           (last.close > last.open && prev.close < prev.open &&
            last.close > prev.open && last.open < prev.close);
  }
  if (dir === "SHORT") {
    return (upperPct > 0.3 && bodyPct < 0.65 && last.close < last.open) ||
           (last.close < last.open && prev.close > prev.open &&
            last.close < prev.open && last.open > prev.close);
  }
  return false;
}

function buildDecision({ candles, sniper, payload }) {
  const range = payload.resistance - payload.support;

  if (!candles || candles.length < 20) {
    return { status: "WAIT", direction: "NEUTRAL", confidence: "LOW", source: "NONE", reason: "insufficient data" };
  }

  // ── Run pattern detection ─────────────────────────────────
  const patterns = [
    detectDoubleTop(candles),
    detectDoubleBottom(candles),
    detectTriangle(candles),
  ].filter(Boolean);

  // ════════════════════════════════════════════════════════
  // PRIORITY 1: PATTERN ENTRY (highest authority)
  // ════════════════════════════════════════════════════════
  const validPatterns = patterns.filter(p => p.status === "ENTRY");
  if (validPatterns.length > 0) {
    const best = validPatterns.reduce((a, b) =>
      ((a.confidence || 0) + Math.min(1, (a.rr || 0) / 3)) >
      ((b.confidence || 0) + Math.min(1, (b.rr || 0) / 3)) ? a : b
    );

    const confirmed = isConfirmationCandle(candles, best.direction);

    return {
      status: confirmed ? "ENTRY" : "PLAN",
      direction: best.direction,
      entry: best.entry,
      tp: best.tp,
      sl: best.sl,
      rr: best.rr,
      confidence: confirmed ? "HIGH" : "MEDIUM",
      source: "PATTERN",
      reason: best.reason,
      extra: {
        neckline: best.neckline || null,
        patternType: best.type,
        confirmed,
      }
    };
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 2: SNIPER ACTIVE (timing trigger)
  // ════════════════════════════════════════════════════════
  if (sniper && (sniper.status?.includes("ACTIVE") || sniper.status?.includes("READY"))) {
    const preferred = sniper.preferred;
    if (preferred === "LONG" || preferred === "SHORT") {
      const confirmed = isConfirmationCandle(candles, preferred);
      return {
        status: confirmed ? "ENTRY" : "PLAN",
        direction: preferred,
        entry: payload.close,
        tp: preferred === "LONG"
          ? round(payload.close + range * 0.4, 2)
          : round(payload.close - range * 0.4, 2),
        sl: preferred === "LONG" ? payload.support : payload.resistance,
        rr: 1.5,
        confidence: confirmed ? "HIGH" : "MEDIUM",
        source: "SNIPER",
        reason: sniper.reason || "sniper zone active",
        extra: { sniperStatus: sniper.status }
      };
    }
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 3: PATTERN PLAN (waiting for break)
  // ════════════════════════════════════════════════════════
  const planPatterns = patterns.filter(p => p.status === "PLAN");
  if (planPatterns.length > 0) {
    const best = planPatterns[0];
    return {
      status: "WAIT",
      direction: best.direction || "NEUTRAL",
      confidence: "LOW",
      source: "PATTERN",
      reason: best.reason,
      extra: {
        neckline: best.neckline || null,
        patternType: best.type,
      }
    };
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 4: WAIT (no valid setup)
  // ════════════════════════════════════════════════════════
  return {
    status: "WAIT",
    direction: "NEUTRAL",
    confidence: "LOW",
    source: "NONE",
    reason: "no valid setup — waiting confluence",
  };
}

module.exports = { buildDecision };
  const range = payload.resistance - payload.support;

  if (!candles || candles.length < 20) {
    return { status: "WAIT", direction: "NEUTRAL", confidence: "LOW", source: "NONE", reason: "insufficient data" };
  }

  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  // ── Pattern Detection ─────────────────────────────────────
  const patterns = [
    detectDoubleTop(candles),
    detectDoubleBottom(candles),
    detectTriangle(candles),
  ].filter(Boolean);

  // ── Helper: detect double top ─────────────────────────────
  function detectDoubleTop(candles) {
    const pivots = getPivots(candles);
    const highs = pivots.filter(p => p.type === "HIGH");
    if (highs.length < 2) return null;

    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const tolerance = h2.price * 0.003;
    if (Math.abs(h1.price - h2.price) > tolerance) return null;

    const necklineCand = pivots.filter(p => p.type === "LOW" && p.index > h1.index && p.index < h2.index);
    if (!necklineCand.length) return null;
    const neckline = necklineCand.reduce((a, b) => a.price < b.price ? a : b);

    const last = candles[candles.length - 1];
    const breakConfirmed = last.close >= neckline.price;

    const entry = last.close;
    const height = h2.price - neckline.price;
    const tp = entry - height;
    const sl = h2.price * 1.0007;
    const rr = Math.abs(entry - tp) / Math.abs(sl - entry);

    return {
      type: "DOUBLE_TOP",
      direction: "SHORT",
      status: breakConfirmed ? "ENTRY" : "PLAN",
      neckline: neckline.price,
      entry: round(entry, 2),
      tp: round(tp, 2),
      sl: round(sl, 2),
      rr: round(rr, 2),
      confidence: 0.85,
      reason: breakConfirmed ? "neckline break confirmed" : `waiting neckline break @ ${round(neckline.price, 2)}`,
    };
  }

  // ── Helper: detect double bottom ──────────────────────────
  function detectDoubleBottom(candles) {
    const pivots = getPivots(candles);
    const lows = pivots.filter(p => p.type === "LOW");
    if (lows.length < 2) return null;

    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    const tolerance = l2.price * 0.003;
    if (Math.abs(l1.price - l2.price) > tolerance) return null;

    const necklineCand = pivots.filter(p => p.type === "HIGH" && p.index > l1.index && p.index < l2.index);
    if (!necklineCand.length) return null;
    const neckline = necklineCand.reduce((a, b) => a.price > b.price ? a : b);

    const last = candles[candles.length - 1];
    const breakConfirmed = last.close <= neckline.price;

    const entry = last.close;
    const height = neckline.price - l2.price;
    const tp = entry + height;
    const sl = l2.price * 0.9993;
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl);

    return {
      type: "DOUBLE_BOTTOM",
      direction: "LONG",
      status: breakConfirmed ? "ENTRY" : "PLAN",
      neckline: neckline.price,
      entry: round(entry, 2),
      tp: round(tp, 2),
      sl: round(sl, 2),
      rr: round(rr, 2),
      confidence: 0.85,
      reason: breakConfirmed ? "neckline break confirmed" : `waiting neckline break @ ${round(neckline.price, 2)}`,
    };
  }

  // ── Helper: detect triangle ───────────────────────────────
  function detectTriangle(candles) {
    const pivots = getPivots(candles);
    const highs = pivots.filter(p => p.type === "HIGH").slice(-3);
    const lows  = pivots.filter(p => p.type === "LOW").slice(-3);
    if (highs.length < 2 || lows.length < 2) return null;

    const descHighs = highs[0].price > highs[highs.length - 1].price;
    const ascLows   = lows[0].price < lows[lows.length - 1].price;
    if (!(descHighs && ascLows)) return null;

    const upper = highs[highs.length - 1].price;
    const lower = lows[lows.length - 1].price;
    const last  = candles[candles.length - 1];

    if (last.close > upper) {
      return {
        type: "TRIANGLE_UP",
        direction: "LONG",
        status: "ENTRY",
        entry: round(last.close, 2),
        tp: round(last.close + (upper - lower), 2),
        sl: round(lower, 2),
        rr: 2,
        confidence: 0.75,
        reason: "triangle breakout upside",
      };
    }
    if (last.close < lower) {
      return {
        type: "TRIANGLE_DOWN",
        direction: "SHORT",
        status: "ENTRY",
        entry: round(last.close, 2),
        tp: round(last.close - (upper - lower), 2),
        sl: round(upper, 2),
        rr: 2,
        confidence: 0.75,
        reason: "triangle breakout downside",
      };
    }
    return {
      type: "TRIANGLE",
      direction: "NEUTRAL",
      status: "PLAN",
      reason: "waiting triangle breakout",
      confidence: 0.5,
    };
  }

  // ── Helper: pivot detection ───────────────────────────────
  function getPivots(data, left = 3, right = 3) {
    const pivots = [];
    for (let i = left; i < data.length - right; i++) {
      const slice = data.slice(i - left, i + right + 1);
      const isHigh = slice.every(c => data[i].high >= c.high);
      const isLow  = slice.every(c => data[i].low <= c.low);
      if (isHigh) pivots.push({ type: "HIGH", price: data[i].high, index: i });
      if (isLow)  pivots.push({ type: "LOW",  price: data[i].low,  index: i });
    }
    return pivots;
  }

  // ── Confirmation Candle Check ─────────────────────────────
  function isConfirmationCandle(dir) {
    if (!lastCandle || !prevCandle) return false;
    const body    = Math.abs(lastCandle.close - lastCandle.open);
    const range   = lastCandle.high - lastCandle.low;
    if (range === 0) return false;
    const bodyPct  = body / range;
    const upperWick = lastCandle.high - Math.max(lastCandle.close, lastCandle.open);
    const lowerWick = Math.min(lastCandle.close, lastCandle.open) - lastCandle.low;
    const upperPct = upperWick / range;
    const lowerPct = lowerWick / range;

    if (dir === "LONG") {
      return (lowerPct > 0.3 && bodyPct < 0.65 && lastCandle.close > lastCandle.open) ||
             (lastCandle.close > lastCandle.open && prevCandle.close < prevCandle.open &&
              lastCandle.close > prevCandle.open && lastCandle.open < prevCandle.close);
    }
    if (dir === "SHORT") {
      return (upperPct > 0.3 && bodyPct < 0.65 && lastCandle.close < lastCandle.open) ||
             (lastCandle.close < lastCandle.open && prevCandle.close > prevCandle.open &&
              lastCandle.close < prevCandle.open && lastCandle.open > prevCandle.close);
    }
    return false;
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 1: PATTERN ENTRY (highest authority)
  // ════════════════════════════════════════════════════════
  const validPatterns = patterns.filter(p => p.status === "ENTRY");
  if (validPatterns.length > 0) {
    const best = validPatterns.reduce((a, b) =>
      ((a.confidence || 0) + Math.min(1, (a.rr || 0) / 3)) >
      ((b.confidence || 0) + Math.min(1, (b.rr || 0) / 3)) ? a : b
    );

    const confirmed = isConfirmationCandle(best.direction);

    return {
      status: confirmed ? "ENTRY" : "PLAN",
      direction: best.direction,
      entry: best.entry,
      tp: best.tp,
      sl: best.sl,
      rr: best.rr,
      confidence: confirmed ? "HIGH" : "MEDIUM",
      source: "PATTERN",
      reason: best.reason,
      extra: {
        neckline: best.neckline || null,
        patternType: best.type,
        confirmed,
      }
    };
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 2: SNIPER ACTIVE (timing trigger)
  // ════════════════════════════════════════════════════════
  if (sniper && (sniper.status?.includes("ACTIVE") || sniper.status?.includes("READY"))) {
    const preferred = sniper.preferred;
    if (preferred === "LONG" || preferred === "SHORT") {
      const confirmed = isConfirmationCandle(preferred);
      return {
        status: confirmed ? "ENTRY" : "PLAN",
        direction: preferred,
        entry: payload.close,
        tp: preferred === "LONG"
          ? round(payload.close + range * 0.4, 2)
          : round(payload.close - range * 0.4, 2),
        sl: preferred === "LONG" ? payload.support : payload.resistance,
        rr: 1.5,
        confidence: confirmed ? "HIGH" : "MEDIUM",
        source: "SNIPER",
        reason: sniper.reason || "sniper zone active",
        extra: { sniperStatus: sniper.status }
      };
    }
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 3: PATTERN PLAN (waiting for break)
  // ════════════════════════════════════════════════════════
  const planPatterns = patterns.filter(p => p.status === "PLAN");
  if (planPatterns.length > 0) {
    const best = planPatterns[0];
    return {
      status: "WAIT",
      direction: best.direction || "NEUTRAL",
      confidence: "LOW",
      source: "PATTERN",
      reason: best.reason,
      extra: {
        neckline: best.neckline || null,
        patternType: best.type,
      }
    };
  }

  // ════════════════════════════════════════════════════════
  // PRIORITY 4: WAIT (no valid setup)
  // ════════════════════════════════════════════════════════
  return {
    status: "WAIT",
    direction: "NEUTRAL",
    confidence: "LOW",
    source: "NONE",
    reason: "no valid setup — waiting confluence",
  };
}