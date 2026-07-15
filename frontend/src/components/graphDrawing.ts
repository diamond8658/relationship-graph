// ─────────────────────────────────────────────────────────────────────────────
// graphDrawing.ts — Low-level SVG element construction for the canvas.
// Extracted from Graph.tsx: these were already pure functions (all inputs as
// explicit parameters, only side effect is appending to the passed-in
// `layer` element) — moved here verbatim, not rewritten, to keep this a
// zero-behavior-change extraction.
// ─────────────────────────────────────────────────────────────────────────────

import { SENTIMENT_COLORS } from "../colors";

export type Point = { x: number; y: number };

// Blend two hex colors by averaging their RGB components
export function blendColors(a: string, b: string): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round((ar + br) / 2).toString(16).padStart(2, "0");
  const g = Math.round((ag + bg) / 2).toString(16).padStart(2, "0");
  const bh = Math.round((ab + bb) / 2).toString(16).padStart(2, "0");
  return `#${r}${g}${bh}`;
}

// Simplified edge — single straight line, no arrowhead, no label
export function drawEdgeSimple(
  layer: SVGGElement, a: Point, b: Point,
  col: string, opacity: number, ns: string
) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;
  const ux = dx / dist, uy = dy / dist;
  const NR = 26;
  const x1 = a.x + ux * NR, y1 = a.y + uy * NR;
  const x2 = b.x - ux * NR, y2 = b.y - uy * NR;
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", col); line.setAttribute("stroke-width", "2");
  line.setAttribute("opacity", String(opacity));
  layer.appendChild(line);
}

export function drawEdgeDir(
  layer: SVGGElement, a: Point, b: Point,
  label: string, col: string, opacity: number, ns: string, side: 1 | -1 | 0,
  fromId?: string, toId?: string
) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;
  const ux = dx / dist, uy = dy / dist;
  // perpendicular unit vector
  const px = -uy, py = ux;
  const NR = 26; // node radius
  // Parallel offset: bidirectional arrows get ±10px, one-way get a small unique jitter
  // so arrows between different pairs don't perfectly overlap
  let lateralOff = side !== 0 ? 10 * side : 0;
  if (side === 0 && fromId && toId) {
    const hash = (fromId + toId).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    lateralOff = ((hash % 7) - 3) * 1.5; // -4.5 to +4.5 px unique per pair
  }
  // Arrow starts on the surface of node A facing B, shifted laterally
  const x1 = a.x + ux * NR + px * lateralOff, y1 = a.y + uy * NR + py * lateralOff;
  // Arrow ends on the surface of node B facing A, shifted same amount
  const x2 = b.x - ux * NR + px * lateralOff, y2 = b.y - uy * NR + py * lateralOff;
  // Straight line — control point at midpoint = no curve
  const cpx = (x1 + x2) / 2;
  const cpy = (y1 + y2) / 2;

  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", `M${x1},${y1} Q${cpx},${cpy} ${x2},${y2}`);
  path.setAttribute("fill", "none"); path.setAttribute("stroke", col);
  path.setAttribute("stroke-width", "2.5"); path.setAttribute("opacity", String(opacity));
  const sentimentKey = Object.entries(SENTIMENT_COLORS).find(([, c]) => c === col)?.[0] || "neutral";
  path.setAttribute("marker-end", `url(#rg-arr-${sentimentKey})`);
  layer.appendChild(path);

  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // Offset label perpendicularly away from center line
    // Offset label further from the arrow line so it doesn't cover arrows
    const labelDist = 18;
    const labelOffsetX = px * labelDist * (side !== 0 ? side : 1);
    const labelOffsetY = py * labelDist * (side !== 0 ? side : 1);
    const lx = mx + labelOffsetX;
    const ly = my + labelOffsetY;
    const display = label.length > 18 ? label.slice(0, 16) + "…" : label;
    const pw = Math.min(display.length * 5.8 + 10, 120), ph = 15;

    const bg = document.createElementNS(ns, "rect");
    bg.setAttribute("x", String(lx - pw / 2)); bg.setAttribute("y", String(ly - ph / 2));
    bg.setAttribute("width", String(pw)); bg.setAttribute("height", String(ph));
    bg.setAttribute("rx", "4"); bg.setAttribute("fill", col);
    bg.setAttribute("opacity", String(opacity * 0.85));
    layer.appendChild(bg);

    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("x", String(lx)); txt.setAttribute("y", String(ly));
    txt.setAttribute("text-anchor", "middle"); txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("font-size", "10"); txt.setAttribute("fill", "#ffffff");
    txt.setAttribute("font-weight", "600");
    txt.setAttribute("opacity", String(opacity)); txt.setAttribute("pointer-events", "none");
    txt.textContent = display;
    layer.appendChild(txt);
  }
}
