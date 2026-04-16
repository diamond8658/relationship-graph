import React, { useRef, useEffect, useCallback } from "react";
import { Person } from "../types";
import { api } from "../api";

const PALETTE = ["#378ADD","#1D9E75","#D85A30","#7F77DD","#BA7517","#D4537E","#639922","#E24B4A"];
const PALETTE_LIGHT = ["#E6F1FB","#E1F5EE","#FAECE7","#EEEDFE","#FAEEDA","#FBEAF0","#EAF3DE","#FCEBEB"];
const PALETTE_TEXT = ["#042C53","#04342C","#4A1B0C","#26215C","#412402","#4B1528","#173404","#501313"];

const groupColorIdx: Record<string, number> = {};
let colorIdx = 0;
const SENTIMENT_COLORS: Record<string, string> = {
  hates: '#7C0A02',
  dislikes: '#ff6e00',
  neutral: '#888780',
  likes: '#03c04a',
  loves: '#4b0082',
};
function sentimentColor(s: string) { return SENTIMENT_COLORS[s] || SENTIMENT_COLORS.neutral; }

function gc(group: string) {
  if (groupColorIdx[group] === undefined) { groupColorIdx[group] = colorIdx++ % PALETTE.length; }
  const i = groupColorIdx[group];
  return { fill: PALETTE[i], light: PALETTE_LIGHT[i], text: PALETTE_TEXT[i] };
}

interface GraphProps {
  people: Person[];
  selectedId: string | null;
  filterText: string;
  onSelectPerson: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onUntangleRef?: React.MutableRefObject<(() => void) | null>;
  onLayoutSaved?: (positions: Record<string, { x: number; y: number }>) => void;
  onUpdated?: () => void;
}

const SENTIMENT_COLORS_MODAL: Record<string, string> = {
  hates: '#7C0A02', dislikes: '#ff6e00', neutral: '#888780',
  likes: '#03c04a', loves: '#4b0082',
};

const ModalRelationships: React.FC<{ modal: any; people: any[] }> = ({ modal, people }) => {
  const [open, setOpen] = React.useState(false);
  const total = modal.outgoing.length + modal.incoming.length;
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f7f7f7", border: "none", borderRadius: 6, padding: "7px 10px", cursor: "pointer", fontSize: 12, color: "#444", fontWeight: 500 }}
      >
        <span>Relationships ({total})</span>
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "8px 4px 0" }}>
          {modal.outgoing.map((rel: any) => (
            <div key={rel.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: SENTIMENT_COLORS_MODAL[rel.sentiment] || "#888", flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12, color: "#555", lineHeight: 1.4 }}>
                <strong style={{ color: "#222" }}>{modal.name}</strong> sees <strong style={{ color: "#222" }}>{people.find((p: any) => p.id === rel.to_id)?.name || rel.to_id}</strong> as <em>"{rel.label}"</em>
              </span>
            </div>
          ))}
          {modal.incoming.map((rel: any) => (
            <div key={rel.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: SENTIMENT_COLORS_MODAL[rel.sentiment] || "#888", flexShrink: 0, opacity: 0.5, marginTop: 2 }} />
              <span style={{ fontSize: 12, color: "#555", lineHeight: 1.4 }}>
                <strong style={{ color: "#222" }}>{people.find((p: any) => p.id === rel.from_id)?.name || rel.from_id}</strong> sees <strong style={{ color: "#222" }}>{modal.name}</strong> as <em>"{rel.label}"</em>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const Graph: React.FC<GraphProps> = ({
  people, selectedId, filterText, onSelectPerson, onDragEnd, onUntangleRef, onLayoutSaved, onUpdated,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [tooltip, setTooltip] = React.useState<{ person: Person; x: number; y: number } | null>(null);
  const [modal, setModal] = React.useState<Person | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const dragConnectRef = useRef<{ fromId: string; x: number; y: number } | null>(null);
  const [connectModal, setConnectModal] = React.useState<{ fromId: string; toId: string } | null>(null);
  const [connectLabel, setConnectLabel] = React.useState("");
  const [connectSentiment, setConnectSentiment] = React.useState<string>("neutral");
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const [transformState, setTransformState] = React.useState({ scale: 1, x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  // Always sync positions from people prop — DB is the source of truth after reloads
  useEffect(() => {
    people.forEach(p => {
      // Only override if the DB value differs significantly (i.e. after a sort/reset)
      // This prevents snapping back during active drag
      const cur = positionsRef.current[p.id];
      if (!cur || (Math.abs(cur.x - p.x) > 2 || Math.abs(cur.y - p.y) > 2)) {
        if (!draggingRef.current || draggingRef.current.id !== p.id) {
          positionsRef.current[p.id] = { x: p.x, y: p.y };
        }
      }
    });
  }, [people]);

  const svgPt = (e: MouseEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const raw = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const t = transformRef.current;
    return { x: (raw.x - t.x) / t.scale, y: (raw.y - t.y) / t.scale };
  };

  const rawPt = (e: MouseEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const applyTransform = (t: { scale: number; x: number; y: number }) => {
    transformRef.current = t;
    setTransformState({ ...t });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = transformRef.current;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.2, Math.min(4, t.scale * delta));
    const newX = mx - (mx - t.x) * (newScale / t.scale);
    const newY = my - (my - t.y) * (newScale / t.scale);
    applyTransform({ scale: newScale, x: newX, y: newY });
  };

  const adjustZoom = (delta: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const t = transformRef.current;
    const newScale = Math.max(0.2, Math.min(4, t.scale + delta));
    const newX = mx - (mx - t.x) * (newScale / t.scale);
    const newY = my - (my - t.y) * (newScale / t.scale);
    applyTransform({ scale: newScale, x: newX, y: newY });
  };

  const resetZoom = () => applyTransform({ scale: 1, x: 0, y: 0 });

  const handlePanStart = (e: React.MouseEvent) => {
    // Only pan on background click - check if click landed on SVG background elements
    const target = e.target as SVGElement;
    const tag = target.tagName.toLowerCase();
    // Allow panning from svg, rect backgrounds, or the transform group directly
    if (tag !== "svg" && tag !== "g" && target.id !== "transform-root" && target.id !== "edges" && target.id !== "nodes") return;
    // Don't pan if a node group is an ancestor
    let el: Element | null = target;
    while (el) {
      if (el.getAttribute && el.getAttribute("class") === "rg-node") return;
      el = el.parentElement;
    }
    isPanningRef.current = true;
    const raw = rawPt(e);
    panStartRef.current = { mx: raw.x, my: raw.y, tx: transformRef.current.x, ty: transformRef.current.y };
  };

  const resolveCollisions = useCallback(() => {
    const NODE_RADIUS = 26;
    const MIN_DIST = NODE_RADIUS * 2 + 20; // minimum distance between node centers
    const ids = Object.keys(positionsRef.current);
    let moved = true;
    let iterations = 0;
    while (moved && iterations < 50) {
      moved = false;
      iterations++;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positionsRef.current[ids[i]];
          const b = positionsRef.current[ids[j]];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MIN_DIST && dist > 0) {
            const overlap = (MIN_DIST - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            positionsRef.current[ids[i]] = { x: a.x - ux * overlap, y: a.y - uy * overlap };
            positionsRef.current[ids[j]] = { x: b.x + ux * overlap, y: b.y + uy * overlap };
            // Sync back to nodes array
            const na = people.find(p => p.id === ids[i]);
            const nb = people.find(p => p.id === ids[j]);
            if (na) { na.x = positionsRef.current[ids[i]].x; na.y = positionsRef.current[ids[i]].y; }
            if (nb) { nb.x = positionsRef.current[ids[j]].x; nb.y = positionsRef.current[ids[j]].y; }
            moved = true;
          }
        }
      }
    }
  }, [people]);

  const runForceLayout = useCallback(() => {
    const W = svgRef.current?.clientWidth || 700;
    const H = svgRef.current?.clientHeight || 500;
    const cx = W / 2, cy = H / 2;
    const ids = people.map(p => p.id);
    if (ids.length === 0) return;

    // Build edge list (deduplicated)
    const edgeSet = new Set<string>();
    const edges: [string, string][] = [];
    people.forEach(p => {
      p.outgoing.forEach((r: any) => {
        const key = [p.id, r.to_id].sort().join("||");
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([p.id, r.to_id]); }
      });
    });

    const REPULSION = 12000;
    const ATTRACTION = 0.015;
    const CROSSING_FORCE = 80;
    const DAMPING = 0.78;
    const CENTER_GRAVITY = 0.04;
    const IDEAL_DIST = Math.max(150, Math.min(250, Math.sqrt((W * H) / Math.max(ids.length, 1)) * 0.8));
    const ITERATIONS = 400;

    ids.forEach(id => {
      const angle = Math.random() * Math.PI * 2;
      const r = 80 + Math.random() * Math.min(W, H) * 0.3;
      positionsRef.current[id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });

    const vel: Record<string, { x: number; y: number }> = {};
    ids.forEach(id => { vel[id] = { x: 0, y: 0 }; });

    // Helper: do segments AB and CD intersect?
    function segmentsIntersect(ax: number, ay: number, bx: number, by: number,
                               cx: number, cy: number, dx: number, dy: number): boolean {
      const d1x = bx - ax, d1y = by - ay;
      const d2x = dx - cx, d2y = dy - cy;
      const cross = d1x * d2y - d1y * d2x;
      if (Math.abs(cross) < 1e-10) return false;
      const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
      const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
      return t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95;
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const force: Record<string, { x: number; y: number }> = {};
      ids.forEach(id => { force[id] = { x: 0, y: 0 }; });

      // Node-node repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positionsRef.current[ids[i]];
          const b = positionsRef.current[ids[j]];
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = REPULSION / (dist * dist);
          const ux = dx / dist, uy = dy / dist;
          force[ids[i]].x -= ux * f; force[ids[i]].y -= uy * f;
          force[ids[j]].x += ux * f; force[ids[j]].y += uy * f;
        }
      }

      // Edge spring attraction
      edges.forEach(([aId, bId]) => {
        const a = positionsRef.current[aId], b = positionsRef.current[bId];
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = ATTRACTION * (dist - IDEAL_DIST);
        const ux = dx / dist, uy = dy / dist;
        force[aId].x += ux * f; force[aId].y += uy * f;
        force[bId].x -= ux * f; force[bId].y -= uy * f;
      });

      // Edge crossing repulsion — push nodes apart when their edges cross
      if (iter % 5 === 0) {
        for (let i = 0; i < edges.length; i++) {
          for (let j = i + 1; j < edges.length; j++) {
            const [a1, a2] = edges[i];
            const [b1, b2] = edges[j];
            // Skip edges that share a node
            if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
            const pa1 = positionsRef.current[a1], pa2 = positionsRef.current[a2];
            const pb1 = positionsRef.current[b1], pb2 = positionsRef.current[b2];
            if (!pa1 || !pa2 || !pb1 || !pb2) continue;
            if (segmentsIntersect(pa1.x, pa1.y, pa2.x, pa2.y, pb1.x, pb1.y, pb2.x, pb2.y)) {
              // Push all 4 endpoints outward from the crossing midpoint
              const mx = (pa1.x + pa2.x + pb1.x + pb2.x) / 4;
              const my = (pa1.y + pa2.y + pb1.y + pb2.y) / 4;
              [a1, a2, b1, b2].forEach((id, idx) => {
                const pos = positionsRef.current[id];
                if (!pos) return;
                const pdx = pos.x - mx, pdy = pos.y - my;
                const pdist = Math.max(Math.sqrt(pdx * pdx + pdy * pdy), 1);
                // Alternate push direction to break symmetry
                const sign = idx < 2 ? 1 : -1;
                force[id].x += (pdx / pdist) * CROSSING_FORCE * sign;
                force[id].y += (pdy / pdist) * CROSSING_FORCE * sign;
              });
            }
          }
        }
      }

      // Center gravity
      ids.forEach(id => {
        const pos = positionsRef.current[id];
        if (!pos) return;
        force[id].x += (cx - pos.x) * CENTER_GRAVITY;
        force[id].y += (cy - pos.y) * CENTER_GRAVITY;
      });

      // Cool down over iterations
      const cooling = 1 - iter / ITERATIONS;
      ids.forEach(id => {
        vel[id].x = (vel[id].x + force[id].x * cooling) * DAMPING;
        vel[id].y = (vel[id].y + force[id].y * cooling) * DAMPING;
        const pos = positionsRef.current[id];
        if (pos) {
          positionsRef.current[id] = {
            x: Math.max(50, Math.min(W - 50, pos.x + vel[id].x)),
            y: Math.max(50, Math.min(H - 50, pos.y + vel[id].y)),
          };
        }
      });
    }

    const finalPositions: Record<string, { x: number; y: number }> = {};
    people.forEach(p => {
      const pos = positionsRef.current[p.id];
      if (pos) finalPositions[p.id] = pos;
    });

    renderRef.current?.();
    if (onLayoutSaved) onLayoutSaved(finalPositions);
  }, [people, onLayoutSaved]);

  const runForceLayoutAnimated = useCallback(() => {
    const W = svgRef.current?.clientWidth || 700;
    const H = svgRef.current?.clientHeight || 500;
    const cx = W / 2, cy = H / 2;
    const ids = people.map(p => p.id);
    if (ids.length === 0) return;

    const meId = people.find(p => p.primary_tag?.toLowerCase() === "me")?.id || null;
    const nonMeIds = ids.filter(id => id !== meId);

    // Build adjacency
    const edgeSet = new Set<string>();
    const edges: [string, string][] = [];
    people.forEach(p => {
      p.outgoing.forEach((r: any) => {
        const key = [p.id, r.to_id].sort().join("||");
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([p.id, r.to_id]); }
      });
    });

    // Degree per node
    const degree: Record<string, number> = {};
    ids.forEach(id => { degree[id] = 0; });
    edges.forEach(([a, b]) => { degree[a]++; degree[b]++; });

    // Build adjacency map
    const neighbors: Record<string, Set<string>> = {};
    ids.forEach(id => { neighbors[id] = new Set(); });
    edges.forEach(([a, b]) => { neighbors[a].add(b); neighbors[b].add(a); });

    // ── Classify nodes ────────────────────────────────────────────────────────
    const leafNodes: { id: string; parentId: string }[] = [];
    const nonLeafIds: string[] = [];
    nonMeIds.forEach(id => {
      if (neighbors[id].size === 1) {
        leafNodes.push({ id, parentId: Array.from(neighbors[id])[0] });
      } else {
        nonLeafIds.push(id);
      }
    });

    // ── Group non-leaf nodes by primary_tag ───────────────────────────────────
    const clusterMap: Record<string, string[]> = {};
    nonLeafIds.forEach(id => {
      const p = people.find(p2 => p2.id === id);
      const tag = p?.primary_tag?.toLowerCase().trim() || "__ungrouped__";
      if (!clusterMap[tag]) clusterMap[tag] = [];
      clusterMap[tag].push(id);
    });
    const clusterKeys = Object.keys(clusterMap).sort((a, b) =>
      clusterMap[b].length - clusterMap[a].length
    );
    const numClusters = clusterKeys.length;

    // ── Hub-and-spoke: Me in center, clusters arranged radially ──────────────
    // Me always goes at canvas center
    if (meId) positionsRef.current[meId] = { x: cx, y: cy };

    // Cluster centers arranged evenly around Me
    // Spoke radius scales with cluster count and canvas size
    const spokeR = Math.min(W, H) * (numClusters <= 2 ? 0.48 : 0.40);
    const clusterCenters: Record<string, { x: number; y: number }> = {};
    // Sort clusters: named groups first (alphabetically), ungrouped last
    const sortedClusterKeys = [...clusterKeys].sort((a, b) => {
      if (a === "__ungrouped__") return 1;
      if (b === "__ungrouped__") return -1;
      return a.localeCompare(b);
    });

    // Distribute clusters evenly across full 360°, starting at top (-π/2)
    sortedClusterKeys.forEach((tag, ci) => {
      const angle = (2 * Math.PI * ci / Math.max(numClusters, 1)) - Math.PI / 2;
      clusterCenters[tag] = {
        x: cx + spokeR * Math.cos(angle),
        y: cy + spokeR * Math.sin(angle),
      };
    });

    // Place nodes within each cluster in an arc facing away from center
    clusterKeys.forEach(tag => {
      const members = clusterMap[tag];
      const center = clusterCenters[tag];
      const facingAngle = Math.atan2(center.y - cy, center.x - cx);
      if (members.length === 1) {
        positionsRef.current[members[0]] = { x: center.x, y: center.y };
      } else {
        // Phyllotaxis (sunflower) placement — uses the golden angle (~137.5°)
        // to place each node. This pattern mathematically guarantees no three
        // nodes are ever collinear, unlike evenly-spaced circles.
        const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.508°
        const spokeAngle = Math.atan2(center.y - cy, center.x - cx);
        // Scale radius so outer nodes sit further out — sqrt gives natural spread
        const baseR = Math.max(60, 40 * Math.sqrt(members.length));
        members.forEach((id, i) => {
          // Radius grows with sqrt(i) so nodes spread outward naturally
          const r = baseR * Math.sqrt(i + 1) / Math.sqrt(members.length);
          // Golden angle rotation offset — irrational so never repeats a line
          const angle = spokeAngle + i * goldenAngle;
          positionsRef.current[id] = {
            x: center.x + r * Math.cos(angle),
            y: center.y + r * Math.sin(angle),
          };
        });
      }
    });

    // Fallback: no clusters — spread on circle
    if (numClusters === 0) {
      nonLeafIds.forEach((id, i) => {
        const angle = (2 * Math.PI * i / Math.max(nonLeafIds.length, 1)) - Math.PI / 2;
        positionsRef.current[id] = {
          x: cx + spokeR * Math.cos(angle),
          y: cy + spokeR * Math.sin(angle),
        };
      });
    }

    // ── Place leaf nodes outside their parent, pointing away from center ──────
    const leavesPerParent: Record<string, string[]> = {};
    leafNodes.forEach(({ id, parentId }) => {
      if (!leavesPerParent[parentId]) leavesPerParent[parentId] = [];
      leavesPerParent[parentId].push(id);
    });

    leafNodes.forEach(({ id, parentId }) => {
      const parentPos = positionsRef.current[parentId] || { x: cx, y: cy };
      const siblings = leavesPerParent[parentId];
      const leafIdx = siblings.indexOf(id);
      const total = siblings.length;
      const baseAngle = Math.atan2(parentPos.y - cy, parentPos.x - cx);
      const leafAngle = baseAngle + (leafIdx - (total - 1) / 2) * 0.6;
      const leafDist = 160;
      let lx = parentPos.x + Math.cos(leafAngle) * leafDist;
      let ly = parentPos.y + Math.sin(leafAngle) * leafDist;

      // Nudge away from other nodes
      let currentAngle = leafAngle;
      for (let nudge = 0; nudge < 12; nudge++) {
        let tooClose = false;
        for (const otherId of [...nonLeafIds, ...(meId ? [meId] : [])]) {
          const oPos = positionsRef.current[otherId];
          if (!oPos) continue;
          const minDist = otherId === parentId ? 140 : 100;
          const dx = lx - oPos.x, dy = ly - oPos.y;
          if (Math.sqrt(dx * dx + dy * dy) < minDist) { tooClose = true; break; }
        }
        if (!tooClose) break;
        currentAngle += 0.3;
        lx = parentPos.x + Math.cos(currentAngle) * leafDist;
        ly = parentPos.y + Math.sin(currentAngle) * leafDist;
      }
      positionsRef.current[id] = { x: lx, y: ly };
    });

        // ── Repulsion-only settle to resolve overlaps ────────────────────────────
    const REPULSION = 25000;
    const DAMPING = 0.7;
    const ITERATIONS = 120;
    const STEPS_PER_FRAME = 8;
    const vel: Record<string, { x: number; y: number }> = {};
    ids.forEach(id => { vel[id] = { x: 0, y: 0 }; });
    // Pin leaf nodes during settle; Me stays centered due to balanced repulsion
    const pinnedIds = new Set<string>(leafNodes.map(l => l.id));

    let iter = 0;
    let rafId: number;

    function step() {
      for (let s = 0; s < STEPS_PER_FRAME && iter < ITERATIONS; s++, iter++) {
        const force: Record<string, { x: number; y: number }> = {};
        ids.forEach(id => { force[id] = { x: 0, y: 0 }; });

        // Only repulsion to push apart overlapping nodes — no attraction
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = positionsRef.current[ids[i]], b = positionsRef.current[ids[j]];
            if (!a || !b) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            if (dist > 350) continue; // only push if too close
            const f = REPULSION / (dist * dist);
            const ux = dx / dist, uy = dy / dist;
            force[ids[i]].x -= ux * f; force[ids[i]].y -= uy * f;
            force[ids[j]].x += ux * f; force[ids[j]].y += uy * f;
          }
        }

        // Keep Me and leaf nodes pinned during settle
        ids.forEach(id => {
          if (pinnedIds.has(id)) { vel[id] = { x: 0, y: 0 }; return; } // pinned nodes don't move
          vel[id].x = (vel[id].x + force[id].x) * DAMPING;
          vel[id].y = (vel[id].y + force[id].y) * DAMPING;
          const pos = positionsRef.current[id];
          if (pos) positionsRef.current[id] = {
            x: Math.max(50, Math.min(W - 50, pos.x + vel[id].x)),
            y: Math.max(50, Math.min(H - 50, pos.y + vel[id].y)),
          };
        });
      }

      renderRef.current?.();

      if (iter < ITERATIONS) {
        rafId = requestAnimationFrame(step);
      } else {
        const finalPositions: Record<string, { x: number; y: number }> = {};
        people.forEach(p => {
          const pos = positionsRef.current[p.id];
          if (pos) finalPositions[p.id] = pos;
        });
        if (onLayoutSaved) onLayoutSaved(finalPositions);
      }
    }

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [people, onLayoutSaved]);

  // Wire the sort button directly to the animated layout — no retry needed since radial is deterministic
  useEffect(() => {
    if (onUntangleRef) onUntangleRef.current = runForceLayoutAnimated;
  }, [onUntangleRef, runForceLayoutAnimated]);



  const render = useCallback(() => {
    resolveCollisions();
    const svg = svgRef.current;
    if (!svg) return;
    const ns = "http://www.w3.org/2000/svg";
    const edgesLayer = svg.querySelector("#edges") as SVGGElement;
    const nodesLayer = svg.querySelector("#nodes") as SVGGElement;
    if (!edgesLayer || !nodesLayer) return;
    edgesLayer.innerHTML = "";
    nodesLayer.innerHTML = "";

    const byId: Record<string, Person> = {};
    people.forEach(p => byId[p.id] = p);

    const pairs = new Set<string>();

    people.forEach(person => {
      const aPos = positionsRef.current[person.id] || { x: person.x, y: person.y };
      person.outgoing.forEach(rel => {
        const key = [person.id, rel.to_id].sort().join("||");
        if (pairs.has(key)) return;
        pairs.add(key);
        const other = byId[rel.to_id];
        if (!other) return;
        const bPos = positionsRef.current[rel.to_id] || { x: other.x, y: other.y };
        const ft2 = filterText.toLowerCase();
        const personMatched = !filterText ||
          person.name.toLowerCase().includes(ft2) ||
          (person.primary_tag && person.primary_tag.toLowerCase().includes(ft2)) ||
          person.tags.some((t: any) => t.label.toLowerCase().includes(ft2));
        const otherMatched = !filterText ||
          other.name.toLowerCase().includes(ft2) ||
          (other.primary_tag && other.primary_tag.toLowerCase().includes(ft2)) ||
          other.tags.some((t: any) => t.label.toLowerCase().includes(ft2));
        const dim = filterText && !personMatched && !otherMatched;

        const reverse = other.outgoing.find(r => r.to_id === person.id);
        const isBidirectional = !!reverse;
        drawEdgeDir(edgesLayer, aPos, bPos, rel.label, sentimentColor(rel.sentiment), dim ? 0.08 : 1, ns, 1, person.id, rel.to_id);
        if (reverse) drawEdgeDir(edgesLayer, bPos, aPos, reverse.label, sentimentColor(reverse.sentiment), dim ? 0.08 : 1, ns, 1, rel.to_id, person.id);
      });
    });

    people.forEach(person => {
      const pos = positionsRef.current[person.id] || { x: person.x, y: person.y };
      // Match against name, primary_tag, and all freeform tags
      const ft = filterText.toLowerCase();
      const matched = !filterText || 
        person.name.toLowerCase().includes(ft) ||
        (person.primary_tag && person.primary_tag.toLowerCase().includes(ft)) ||
        person.tags.some((t: any) => t.label.toLowerCase().includes(ft));
      // "Me" node gets a special gold color
      const isMe = person.primary_tag?.toLowerCase() === "me";
      const c = isMe
        ? { fill: "#F59E0B", light: "#FEF3C7", text: "#78350F" }
        : gc(person.primary_tag || person.name);
      const g = document.createElementNS(ns, "g") as SVGGElement;
      g.setAttribute("transform", `translate(${pos.x},${pos.y})`);
      g.setAttribute("class", "rg-node");
      g.style.cursor = "pointer";
      if (!matched) {
        g.setAttribute("opacity", "0.12");
        g.setAttribute("filter", "grayscale(1)");
      } else if (filterText) {
        // Slightly boost matched nodes when filter is active so they pop
        g.setAttribute("filter", "drop-shadow(0 0 6px rgba(55,138,221,0.5))");
      }

      if (person.photo) {
        const clipId = "clip-" + person.id.replace(/\W/g, "_");
        let defs = svg.querySelector("defs")!;
        if (!svg.querySelector("#" + clipId)) {
          const clip = document.createElementNS(ns, "clipPath");
          clip.setAttribute("id", clipId);
          const cr = document.createElementNS(ns, "circle"); cr.setAttribute("r", "26");
          clip.appendChild(cr); defs.appendChild(clip);
        }
        const img = document.createElementNS(ns, "image");
        img.setAttribute("href", person.photo); img.setAttribute("x", "-26"); img.setAttribute("y", "-26");
        img.setAttribute("width", "52"); img.setAttribute("height", "52");
        img.setAttribute("clip-path", `url(#${clipId})`);
        const ring = document.createElementNS(ns, "circle");
        ring.setAttribute("r", "26"); ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", person.id === selectedId ? "#2563EB" : c.fill);
        ring.setAttribute("stroke-width", person.id === selectedId ? "3" : "2");
        g.appendChild(img); g.appendChild(ring);
      } else {
        const circle = document.createElementNS(ns, "circle");
        const isDropTarget = person.id === dropTargetId;
        circle.setAttribute("r", isMe ? "30" : "26"); circle.setAttribute("fill", c.fill);
        circle.setAttribute("stroke", person.id === selectedId ? "#2563EB" : isDropTarget ? "#378ADD" : isMe ? "#D97706" : "#fff");
        circle.setAttribute("stroke-width", person.id === selectedId ? "3" : isDropTarget ? "4" : isMe ? "3" : "2");
        g.appendChild(circle);
        const initials = person.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
        const t = document.createElementNS(ns, "text");
        t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "central");
        t.setAttribute("font-size", "12"); t.setAttribute("font-weight", "600");
        t.setAttribute("fill", c.text); t.setAttribute("pointer-events", "none");
        t.textContent = initials; g.appendChild(t);
      }

      const lbl = document.createElementNS(ns, "text");
      lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("y", "40");
      lbl.setAttribute("font-size", "11"); lbl.setAttribute("fill", "#666");
      lbl.setAttribute("pointer-events", "none"); lbl.textContent = person.name;
      g.appendChild(lbl);



      g.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const pt = svgPt(e);
        if ((e as MouseEvent).shiftKey) {
          // Shift+drag to create relationship
          dragConnectRef.current = { fromId: person.id, x: pos.x, y: pos.y };
        } else {
          draggingRef.current = { id: person.id, offX: pos.x - pt.x, offY: pos.y - pt.y };
        }
      });
      g.addEventListener("mouseenter", (e2) => {
        if (dragConnectRef.current && dragConnectRef.current.fromId !== person.id) {
          setDropTargetId(person.id);
        }
      });
      g.addEventListener("mouseleave", () => {
        setDropTargetId(null);
      });
      g.addEventListener("mouseup", (e2) => {
        if (dragConnectRef.current && dragConnectRef.current.fromId !== person.id) {
          const fromId = dragConnectRef.current.fromId;
          dragConnectRef.current = null;
          setDropTargetId(null);
          setConnectLabel("");
          setConnectSentiment("neutral");
          setConnectModal({ fromId, toId: person.id });
        }
      });
      g.addEventListener("mouseenter", (e) => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          const rect = svgRef.current!.getBoundingClientRect();
          setTooltip({ person, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }, 400);
      });
      g.addEventListener("mouseleave", () => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        setTooltip(null);
      });
      g.addEventListener("click", () => {
        if (draggingRef.current) return;
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
        clickTimerRef.current = setTimeout(() => {
          setModal(person);
          clickTimerRef.current = null;
        }, 220);
      });
      g.addEventListener("dblclick", () => {
        if (draggingRef.current) return;
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        setModal(null);
        onSelectPerson(person.id);
      });
      nodesLayer.appendChild(g);
    });
  }, [people, selectedId, filterText, onSelectPerson, resolveCollisions]);

  function drawEdgeDir(
    layer: SVGGElement, a: { x: number; y: number }, b: { x: number; y: number },
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
    const sentimentKey = Object.entries(SENTIMENT_COLORS).find(([,c]) => c === col)?.[0] || "neutral";
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

  useEffect(() => { renderRef.current = render; render(); }, [render]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragConnectRef.current) {
      // Draw a live connecting line while shift-dragging
      const svg = svgRef.current;
      if (svg) {
        let line = svg.querySelector("#drag-connect-line") as SVGLineElement;
        if (!line) {
          const ns = "http://www.w3.org/2000/svg";
          line = document.createElementNS(ns, "line") as SVGLineElement;
          line.setAttribute("id", "drag-connect-line");
          line.setAttribute("stroke", "#378ADD");
          line.setAttribute("stroke-width", "2");
          line.setAttribute("stroke-dasharray", "6,3");
          line.setAttribute("pointer-events", "none");
          svg.querySelector("#transform-root")?.appendChild(line);
        }
        const raw = svgPt(e);
        line.setAttribute("x1", String(dragConnectRef.current.x));
        line.setAttribute("y1", String(dragConnectRef.current.y));
        line.setAttribute("x2", String(raw.x));
        line.setAttribute("y2", String(raw.y));
      }
      return;
    }
    if (isPanningRef.current && !draggingRef.current) {
      const raw = rawPt(e);
      const t = transformRef.current;
      applyTransform({
        scale: t.scale,
        x: panStartRef.current.tx + (raw.x - panStartRef.current.mx),
        y: panStartRef.current.ty + (raw.y - panStartRef.current.my),
      });
      return;
    }
    if (!draggingRef.current) return;
    const pt = svgPt(e);
    const { id, offX, offY } = draggingRef.current;
    positionsRef.current[id] = { x: pt.x + offX, y: pt.y + offY };
    render();
  }, [render]);

  const cleanupDragConnect = () => {
    dragConnectRef.current = null;
    setDropTargetId(null);
    svgRef.current?.querySelector("#drag-connect-line")?.remove();
  };

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanningRef.current = false;
    if (dragConnectRef.current) {
      cleanupDragConnect();
    }
    if (!draggingRef.current) return;
    const { id } = draggingRef.current;
    const pos = positionsRef.current[id];
    onDragEnd(id, pos.x, pos.y);
    draggingRef.current = null;
  }, [onDragEnd]);

  const zoomBtnStyle: React.CSSProperties = {
    width: 28, height: 28, background: "#fff", border: "1px solid #ddd",
    borderRadius: 6, cursor: "pointer", fontSize: 16, fontWeight: 600,
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 1px 4px rgba(0,0,0,0.1)", color: "#444",
    padding: 0,
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        ref={svgRef}
        style={{ width: "100%", height: "100%", background: "#f8f9fa", cursor: isPanningRef.current ? "grabbing" : "default" }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={(e) => { handleMouseUp(e); setTooltip(null); if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); isPanningRef.current = false; cleanupDragConnect(); }}
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
      >
        <defs>
          {Object.entries(SENTIMENT_COLORS).map(([sentiment, color]) => (
            <marker
              key={sentiment}
              id={`rg-arr-${sentiment}`}
              viewBox="0 0 10 10"
              refX="8" refY="5"
              markerWidth="5" markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M2 1L8 5L2 9" fill="none" stroke={color}
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </marker>
          ))}
        </defs>
        <g id="transform-root" transform={`translate(${transformState.x},${transformState.y}) scale(${transformState.scale})`}>
          <g id="edges" />
          <g id="nodes" />
        </g>
      </svg>

      {/* Zoom controls */}
      <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
        <button onClick={() => adjustZoom(0.2)} style={zoomBtnStyle}>+</button>
        <button onClick={() => adjustZoom(-0.2)} style={zoomBtnStyle}>−</button>
        <button onClick={resetZoom} style={{ ...zoomBtnStyle, fontSize: 9, padding: "4px 6px" }} title="Reset zoom">⊙</button>
      </div>

      {/* Drag-to-connect modal */}
      {connectModal && (() => {
        const fromPerson = people.find(p => p.id === connectModal.fromId);
        const toPerson = people.find(p => p.id === connectModal.toId);
        const SENTIMENT_COLORS_C: Record<string, string> = { hates: '#7C0A02', dislikes: '#ff6e00', neutral: '#888780', likes: '#03c04a', loves: '#4b0082' };
        const SENTIMENTS_C = ['hates','dislikes','neutral','likes','loves'];
        return (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }}
            onClick={e => { if (e.target === e.currentTarget) setConnectModal(null); }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 10 }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#222" }}>
                Connect <span style={{ color: "#378ADD" }}>{fromPerson?.name}</span> → <span style={{ color: "#378ADD" }}>{toPerson?.name}</span>
              </div>
              <input
                autoFocus
                value={connectLabel}
                onChange={e => setConnectLabel(e.target.value)}
                placeholder="Label (e.g. Friend, Colleague)"
                onKeyDown={async e => {
                  if (e.key === "Enter" && connectLabel.trim()) {
                    await api.createRelationship({ from_id: connectModal.fromId, to_id: connectModal.toId, label: connectLabel.trim(), sentiment: connectSentiment });
                    setConnectModal(null); setConnectLabel(""); onUpdated?.();
                  }
                  if (e.key === "Escape") setConnectModal(null);
                }}
                style={{ fontSize: 13, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, outline: "none" }}
              />
              <select value={connectSentiment} onChange={e => setConnectSentiment(e.target.value)}
                style={{ fontSize: 13, padding: "5px 8px", border: `1px solid ${SENTIMENT_COLORS_C[connectSentiment]}`, borderRadius: 6, color: SENTIMENT_COLORS_C[connectSentiment], fontWeight: 600 }}>
                {SENTIMENTS_C.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={async () => {
                  if (!connectLabel.trim()) return;
                  await api.createRelationship({ from_id: connectModal.fromId, to_id: connectModal.toId, label: connectLabel.trim(), sentiment: connectSentiment });
                  setConnectModal(null); setConnectLabel(""); onUpdated?.();
                }} style={{ flex: 2, padding: "6px 0", background: connectLabel.trim() ? "#378ADD" : "#ccc", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>Connect</button>
                <button onClick={() => setConnectModal(null)} style={{ flex: 1, padding: "6px 0", background: "#f0f0f0", color: "#444", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              </div>
              <div style={{ fontSize: 10, color: "#aaa", textAlign: "center" }}>Press Enter to connect, Escape to cancel</div>
            </div>
          </div>
        );
      })()}

      {/* Hover tooltip */}
      {tooltip && !draggingRef.current && (
        <div style={{
          position: "absolute",
          left: tooltip.x + 16,
          top: tooltip.y - 8,
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          pointerEvents: "none",
          zIndex: 20,
          maxWidth: 200,
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, color: "#222", marginBottom: 2 }}>{tooltip.person.name}</div>
          <div style={{ color: "#888", fontSize: 11, marginBottom: tooltip.person.occupation ? 4 : 0 }}>{tooltip.person.primary_tag || tooltip.person.occupation || ""}</div>
          {tooltip.person.occupation && <div style={{ color: "#444", lineHeight: 1.4 }}>{tooltip.person.occupation}{tooltip.person.company ? ` @ ${tooltip.person.company}` : ""}</div>}
        </div>
      )}

      {/* Click modal */}
      {modal && (
        <div
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}
          onClick={() => setModal(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: 340, maxHeight: "80%", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Avatar */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              {modal.photo ? (
                <img src={modal.photo} alt="" style={{ width: 60, height: 60, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 60, height: 60, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 700, background: "#E6F1FB", color: "#378ADD",
                }}>
                  {modal.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
                </div>
              )}
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>{modal.name}</div>
                <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>{modal.primary_tag || modal.occupation || ""}</div>
              </div>
            </div>

            {/* About */}
            {(modal.occupation || modal.phone || modal.email) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>About</div>
                {modal.occupation && (
                  <div style={{ fontSize: 13, color: "#333", lineHeight: 1.6, marginBottom: 4 }}>
                    {modal.occupation}{modal.company ? ` @ ${modal.company}` : ""}{modal.location ? ` · ${modal.location}` : ""}
                  </div>
                )}
                {modal.phone && (
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#aaa", fontSize: 11 }}>📞</span>{modal.phone}
                  </div>
                )}
                {modal.email && (
                  <div style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#aaa", fontSize: 11 }}>✉</span>
                    <a href={`mailto:${modal.email}`} style={{ color: "#378ADD", textDecoration: "none" }}>{modal.email}</a>
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            {modal.description && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Description</div>
                <div style={{ fontSize: 13, color: "#333", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{modal.description}</div>
              </div>
            )}

            {/* Timeline */}
            {modal.timeline && modal.timeline.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Timeline</div>
                <div style={{ position: "relative", paddingLeft: 18 }}>
                  <div style={{ position: "absolute", left: 6, top: 4, bottom: 4, width: 2, background: "#e0e0e0", borderRadius: 1 }} />
                  {[...modal.timeline].reverse().map((entry: any) => (
                    <div key={entry.id} style={{ position: "relative", marginBottom: 12 }}>
                      <div style={{ position: "absolute", left: -15, top: 3, width: 8, height: 8, borderRadius: "50%", background: "#378ADD", border: "2px solid #fff", boxShadow: "0 0 0 1px #378ADD" }} />
                      <div style={{ fontSize: 10, color: "#888", fontWeight: 600, marginBottom: 2 }}>{entry.date}</div>
                      <div style={{ fontSize: 12, color: "#444", lineHeight: 1.5 }}>{entry.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Relationships — collapsible */}
            {(modal.outgoing.length > 0 || modal.incoming.length > 0) && (
              <ModalRelationships modal={modal} people={people} />
            )}

            <button
              onClick={() => setModal(null)}
              style={{ marginTop: 16, width: "100%", padding: "8px 0", background: "#f0f0f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#444" }}
            >Close</button>
          </div>
        </div>
      )}
    </div>
  );
};
