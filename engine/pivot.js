// ── Pivot Detection (core for all patterns) ──────────────────
export function getPivots(data, left = 3, right = 3) {
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