// ── Pattern Engine (Master Brain) ────────────────────────────
import { detectDoubleTopPro } from "./engine/doubleTopPro.js";
import { detectDoubleBottomPro } from "./engine/doubleBottomPro.js";
import { detectTrianglePro } from "./engine/trianglePro.js";

export function runPatternEngine(candles) {
  const patterns = [
    detectDoubleTopPro(candles),
    detectDoubleBottomPro(candles),
    detectTrianglePro(candles),
  ].filter(Boolean);

  if (!patterns.length) {
    return { status: "WAIT", reason: "no pattern" };
  }

  const entries = patterns.filter(p => p.status === "ENTRY");
  const pool = entries.length ? entries : patterns;

  let best = null;
  for (const p of pool) {
    const score = (p.confidence || 0) + Math.min(1, (p.rr || 0) / 3);
    if (!best || score > best.score) best = { ...p, score };
  }

  if (best.status !== "ENTRY") {
    return { status: "WAIT", reason: best.reason || "waiting confirmation" };
  }

  return {
    status: "ENTRY",
    source: "PATTERN",
    direction: best.direction,
    entry: best.entry,
    tp: best.tp,
    sl: best.sl,
    rr: best.rr,
    score: Math.round(best.score),
    pattern: best.type,
    reason: `${best.type} confirmed`
  };
}