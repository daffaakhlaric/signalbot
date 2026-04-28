import { getPivots } from "./pivot.js";

export function detectDoubleBottomPro(data) {
  if (data.length < 20) return null;
  const pivots = getPivots(data);
  const lows  = pivots.filter(p => p.type === "LOW");
  const highs = pivots.filter(p => p.type === "HIGH");

  if (lows.length < 2 || highs.length < 2) return null;

  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  const tolerance = l2.price * 0.003;
  if (Math.abs(l1.price - l2.price) > tolerance) return null;

  const necklineCand = highs.filter(h => h.index > l1.index && h.index < l2.index);
  if (!necklineCand.length) return null;
  const neckline = necklineCand.reduce((a, b) => a.price > b.price ? a : b);

  const last = data[data.length - 1];
  if (last.close <= neckline.price) {
    return {
      type: "DOUBLE_BOTTOM", status: "PLAN",
      direction: "LONG", neckline: neckline.price,
      reason: "waiting neckline break"
    };
  }

  const entry = last.close;
  const height = neckline.price - l2.price;
  const tp = entry + height;
  const sl = l2.price * 0.9993;
  const rr = (tp - entry) / (entry - sl);
  if (rr < 1.5) return null;

  return {
    type: "DOUBLE_BOTTOM", status: "ENTRY", source: "PATTERN",
    direction: "LONG", entry: round(entry, 2), tp: round(tp, 2), sl: round(sl, 2),
    rr: round(rr, 2), neckline: round(neckline.price, 2), confidence: 0.85
  };
}

const round = (v, d = 2) => v == null || isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;