import { getPivots } from "./pivot.js";

export function detectTrianglePro(data) {
  if (data.length < 20) return null;
  const pivots = getPivots(data);
  const highs = pivots.filter(p => p.type === "HIGH").slice(-3);
  const lows  = pivots.filter(p => p.type === "LOW").slice(-3);

  if (highs.length < 2 || lows.length < 2) return null;

  const descHighs = highs[0].price > highs[highs.length - 1].price;
  const ascLows    = lows[0].price < lows[lows.length - 1].price;
  if (!(descHighs && ascLows)) return null;

  const upper = highs[highs.length - 1].price;
  const lower = lows[lows.length - 1].price;
  const last  = data[data.length - 1];

  if (last.close > upper) {
    return {
      type: "TRIANGLE_BREAKOUT", status: "ENTRY",
      direction: "LONG", entry: round(last.close, 2),
      tp: round(last.close + (upper - lower), 2),
      sl: round(lower, 2), rr: 2, confidence: 0.75
    };
  }

  if (last.close < lower) {
    return {
      type: "TRIANGLE_BREAKDOWN", status: "ENTRY",
      direction: "SHORT", entry: round(last.close, 2),
      tp: round(last.close - (upper - lower), 2),
      sl: round(upper, 2), rr: 2, confidence: 0.75
    };
  }

  return { type: "TRIANGLE", status: "PLAN", reason: "waiting breakout" };
}

const round = (v, d = 2) => v == null || isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;