import { getPivots } from "./pivot.js";

export function detectDoubleTopPro(data) {
  if (data.length < 20) return null;
  const pivots = getPivots(data);
  const highs = pivots.filter(p => p.type === "HIGH");
  const lows  = pivots.filter(p => p.type === "LOW");

  if (highs.length < 2 || lows.length < 2) return null;

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const tolerance = h2.price * 0.003;
  if (Math.abs(h1.price - h2.price) > tolerance) return null;

  const necklineCand = lows.filter(l => l.index > h1.index && l.index < h2.index);
  if (!necklineCand.length) return null;
  const neckline = necklineCand.reduce((a, b) => a.price < b.price ? a : b);

  const last = data[data.length - 1];
  if (last.close >= neckline.price) {
    return {
      type: "DOUBLE_TOP", status: "PLAN",
      direction: "SHORT", neckline: neckline.price,
      reason: "waiting neckline break"
    };
  }

  const entry = last.close;
  const height = h2.price - neckline.price;
  const tp = entry - height;
  const sl = h2.price * 1.0007;
  const rr = (entry - tp) / (sl - entry);
  if (rr < 1.5) return null;

  return {
    type: "DOUBLE_TOP", status: "ENTRY", source: "PATTERN",
    direction: "SHORT", entry: round(entry, 2), tp: round(tp, 2), sl: round(sl, 2),
    rr: round(rr, 2), neckline: round(neckline.price, 2), confidence: 0.85
  };
}

const round = (v, d = 2) => v == null || isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;