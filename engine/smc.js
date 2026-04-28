// ── SMC Engine — Sweep, BOS, CHoCH, Inducement Detection ───────
var round = function(v, d) {
  d = d || 2;
  return v == null || isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
};

function detectLiquiditySweep(candles) {
  if (candles.length < 3) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var prev2 = candles[candles.length - 3];
  if (!last || !prev || !prev2) return null;

  if (prev.high > prev2.high) {
    if (last.high > prev.high && last.close < prev.high && last.close < last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        status: "ACTIVE",
        direction: "SHORT",
        entry: round(last.close, 2),
        tp: round(last.close - (prev.high - prev.low) * 0.5, 2),
        sl: round(last.high * 1.001, 2),
        rr: 1.5,
        confidence: 0.3,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep short"
      };
    }
  }

  if (prev.low < prev2.low) {
    if (last.low < prev.low && last.close > prev.low && last.close > last.open) {
      return {
        type: "LIQUIDITY_SWEEP",
        status: "ACTIVE",
        direction: "LONG",
        entry: round(last.close, 2),
        tp: round(last.close + (prev.high - prev.low) * 0.5, 2),
        sl: round(last.low * 0.999, 2),
        rr: 1.5,
        confidence: 0.3,
        pattern: "LIQUIDITY_SWEEP",
        reason: "liquidity sweep long"
      };
    }
  }

  return null;
}

function detectInducement(candles) {
  if (candles.length < 2) return null;
  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  if (!last || !prev) return null;

  if (last.high > prev.high && last.close < prev.close && last.close < last.open) {
    return {
      type: "INDUCEMENT_SHORT",
      status: "ACTIVE",
      direction: "SHORT",
      confidence: 0.2,
      pattern: "INDUCEMENT",
      reason: "inducement short"
    };
  }

  if (last.low < prev.low && last.close > prev.close && last.close > last.open) {
    return {
      type: "INDUCEMENT_LONG",
      status: "ACTIVE",
      direction: "LONG",
      confidence: 0.2,
      pattern: "INDUCEMENT",
      reason: "inducement long"
    };
  }

  return null;
}

function detectBOS(candles) {
  if (candles.length < 10) return null;
  var last = candles[candles.length - 1];
  var prevCandles = candles.slice(-10, -1);
  var prevHigh = Math.max.apply(null, prevCandles.map(function(c) { return c.high; }));
  var prevLow = Math.min.apply(null, prevCandles.map(function(c) { return c.low; }));

  if (last.close > prevHigh) {
    var range = prevHigh - prevLow;
    return {
      type: "BOS",
      status: "ACTIVE",
      direction: "LONG",
      entry: round(last.close, 2),
      tp: round(last.close + range * 0.6, 2),
      sl: round(prevLow, 2),
      rr: 1.5,
      confidence: 0.2,
      pattern: "BOS",
      reason: "BOS upside"
    };
  }
  if (last.close < prevLow) {
    var range = prevHigh - prevLow;
    return {
      type: "BOS",
      status: "ACTIVE",
      direction: "SHORT",
      entry: round(last.close, 2),
      tp: round(last.close - range * 0.6, 2),
      sl: round(prevHigh, 2),
      rr: 1.5,
      confidence: 0.2,
      pattern: "BOS",
      reason: "BOS downside"
    };
  }
  return null;
}

function detectCHoCH(candles, structure) {
  if (candles.length < 10 || !structure) return null;
  var last = candles[candles.length - 1];
  var prevCandles = candles.slice(-10, -1);
  var prevLow = Math.min.apply(null, prevCandles.map(function(c) { return c.low; }));
  var prevHigh = Math.max.apply(null, prevCandles.map(function(c) { return c.high; }));

  if (structure === "HH" && last.close < prevLow) {
    var range = prevHigh - prevLow;
    return {
      type: "CHOCH",
      status: "ACTIVE",
      direction: "SHORT",
      entry: round(last.close, 2),
      tp: round(last.close - range * 0.6, 2),
      sl: round(prevHigh, 2),
      rr: 1.5,
      confidence: 0.3,
      pattern: "CHOCH",
      reason: "structure flip HH -> bear"
    };
  }
  if (structure === "LL" && last.close > prevHigh) {
    var range = prevHigh - prevLow;
    return {
      type: "CHOCH",
      status: "ACTIVE",
      direction: "LONG",
      entry: round(last.close, 2),
      tp: round(last.close + range * 0.6, 2),
      sl: round(prevLow, 2),
      rr: 1.5,
      confidence: 0.3,
      pattern: "CHOCH",
      reason: "structure flip LL -> bull"
    };
  }
  return null;
}

function getSMCEntry(smc) {
  var sweep = smc.sweep;
  var inducement = smc.inducement;
  var bos = smc.bos;
  var choch = smc.choch;

  var totalConfidence = Math.min(
    (sweep ? sweep.confidence : 0) +
    (choch ? choch.confidence : 0) +
    (bos ? bos.confidence : 0) +
    (inducement ? inducement.confidence : 0),
    1.0
  );

  function calcRR(entry, tp, sl) {
    if (!entry || !tp || !sl) return 1.5;
    var rr = Math.abs(tp - entry) / Math.abs(entry - sl);
    return Math.round(rr * 100) / 100;
  }

  if (sweep && choch && sweep.direction === choch.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "sweep + choch",
      smcComponents: { sweep: true, choch: true }
    };
  }

  if (sweep && bos && sweep.direction === bos.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "sweep + BOS",
      smcComponents: { sweep: true, bos: true }
    };
  }

  if (inducement && sweep && inducement.direction === sweep.direction) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "inducement + sweep",
      smcComponents: { inducement: true, sweep: true }
    };
  }

  if (bos && choch && bos.direction === choch.direction) {
    return {
      status: "ENTRY",
      direction: bos.direction,
      entry: bos.entry,
      tp: bos.tp,
      sl: bos.sl,
      rr: calcRR(bos.entry, bos.tp, bos.sl),
      confidence: totalConfidence,
      reason: "BOS + CHOCH",
      smcComponents: { bos: true, choch: true }
    };
  }

  if (sweep && sweep.entry && sweep.tp && sweep.sl) {
    return {
      status: "ENTRY",
      direction: sweep.direction,
      entry: sweep.entry,
      tp: sweep.tp,
      sl: sweep.sl,
      rr: calcRR(sweep.entry, sweep.tp, sweep.sl),
      confidence: totalConfidence,
      reason: "single sweep",
      smcComponents: { sweep: true }
    };
  }

  if (bos && bos.entry && bos.tp && bos.sl) {
    return {
      status: "ENTRY",
      direction: bos.direction,
      entry: bos.entry,
      tp: bos.tp,
      sl: bos.sl,
      rr: calcRR(bos.entry, bos.tp, bos.sl),
      confidence: totalConfidence,
      reason: "single BOS",
      smcComponents: { bos: true }
    };
  }

  if (choch && choch.entry && choch.tp && choch.sl) {
    return {
      status: "ENTRY",
      direction: choch.direction,
      entry: choch.entry,
      tp: choch.tp,
      sl: choch.sl,
      rr: calcRR(choch.entry, choch.tp, choch.sl),
      confidence: totalConfidence,
      reason: "single CHOCH",
      smcComponents: { choch: true }
    };
  }

  return null;
}

module.exports = {
  detectLiquiditySweep: detectLiquiditySweep,
  detectInducement: detectInducement,
  detectBOS: detectBOS,
  detectCHoCH: detectCHoCH,
  getSMCEntry: getSMCEntry
};