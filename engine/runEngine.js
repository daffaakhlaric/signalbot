var ob;
try { ob = require("./ob"); } catch(e) { ob = { detectOrderBlock: function() { return null; } }; }

var fvg;
try { fvg = require("./fvg"); } catch(e) { fvg = { detectFVG: function() { return null; } }; }

var smc;
try { smc = require("./smc"); } catch(e) { smc = { detectLiquiditySweep: function() { return null; }, detectBOS: function() { return null; }, getSMCEntry: function() { return null; } }; }

function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return 50;
  var gains = 0, losses = 0;
  for (var i = closes.length - period; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  var rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

function calcVolatility(candles) {
  if (!candles || candles.length < 20) return 0;
  var returns = [];
  for (var i = 1; i < candles.length; i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  var mean = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
  var variance = returns.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / returns.length;
  return Math.round(Math.sqrt(variance) * 100 * 100);
}

function detectStructure(highs, lows) {
  if (highs.length < 10 || lows.length < 10) return "NA";
  var recentH = highs.slice(-10), recentL = lows.slice(-10);
  var priorH = highs.slice(-20, -10), priorL = lows.slice(-20, -10);
  var maxRH = Math.max.apply(null, recentH), maxRL = Math.min.apply(null, recentL);
  var maxPH = Math.max.apply(null, priorH), maxPL = Math.min.apply(null, priorL);
  if (maxRH > maxPH && maxRL > maxPL) return "HH";
  if (maxRH < maxPH && maxRL < maxPL) return "LL";
  if (maxRH > maxPH) return "LH";
  if (maxRL < maxPL) return "HL";
  return "NA";
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

function detectEngulfing(prev, curr) {
  if (!prev || !curr) return null;
  var bullish = curr.close > curr.open && prev.close < prev.open && curr.close > prev.open && curr.open < prev.close;
  var bearish = curr.close < curr.open && prev.close > prev.open && curr.open > prev.close && curr.close < prev.open;
  if (bullish) return { type: "LONG", strength: "ENGULFING" };
  if (bearish) return { type: "SHORT", strength: "ENGULFING" };
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

function runEngine(context, candles) {
  if (!candles || candles.length < 20) {
    return { signal: null, position: null, stats: { volatility: 0 } };
  }

  var last = candles[candles.length - 1];
  var prev = candles[candles.length - 2];
  var price = last.close;
  var closes = candles.map(function(c) { return c.close; });
  var highs = candles.map(function(c) { return c.high; });
  var lows = candles.map(function(c) { return c.low; });

  var rsi = calcRSI(closes);
  var volatility = calcVolatility(candles);
  var structure = detectStructure(highs, lows);

  var obDetected = ob.detectOrderBlock(candles);
  var fvgDetected = fvg.detectFVG(candles);
  var sweep = smc.detectLiquiditySweep(candles);
  var bos = smc.detectBOS(candles);
  var fake = detectFakeBreakout(candles);
  var engulf = prev ? detectEngulfing(prev, last) : null;

  var htf_bias = context && context.htf_bias ? context.htf_bias : "NEUTRAL";

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

  if (dir && htf_bias === dir) {
    score += 20;
    reasons.push("HTF align");
  }

  if (dir && obDetected && obDetected.direction === dir && nearZone(price, obDetected.zone)) {
    score += 15;
    reasons.push("OB zone");
  }

  if (dir && fvgDetected && fvgDetected.direction === dir && nearZone(price, fvgDetected.zone)) {
    score += 10;
    reasons.push("FVG");
  }

  if (dir && (structure === "HH" || structure === "HL") && dir === "LONG") {
    score += 10;
    reasons.push("bull structure");
  }
  if (dir && (structure === "LL" || structure === "LH") && dir === "SHORT") {
    score += 10;
    reasons.push("bear structure");
  }

  if (dir && sweep) {
    score += 10;
    reasons.push("sweep confirm");
  }

  var signal = null;
  if (dir && score >= 60) {
    signal = {
      type: dir,
      entry: price,
      tp: dir === "LONG" ? price + 150 : price - 150,
      sl: dir === "LONG" ? price - 80 : price + 80,
      score: score,
      confidence: score >= 75 ? "HIGH" : "MED",
      reasons: reasons,
      candle: last,
      ob: obDetected,
      fvg: fvgDetected
    };
  } else if (!dir || score < 40) {
    signal = {
      type: "CHOPPY",
      score: 0,
      confidence: "LOW",
      reasons: ["no clear signal"],
      candle: last
    };
  }

  var position = null;
  if (signal && signal.type !== "CHOPPY") {
    var range = highs.slice(-20).reduce(function(a, b) { return Math.max(a, b); }) - lows.slice(-20).reduce(function(a, b) { return Math.min(a, b); });
    position = {
      entry: signal.entry,
      tp: signal.tp,
      sl: signal.sl,
      direction: signal.type
    };
  }

  return {
    signal: signal,
    position: position,
    stats: {
      rsi: Math.round(rsi),
      volatility: volatility,
      structure: structure,
      htf_bias: htf_bias
    }
  };
}

module.exports = { runEngine };
