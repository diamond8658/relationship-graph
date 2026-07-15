import React, { useRef, useEffect, useCallback } from "react";
import { Person } from "../types";
import { api } from "../api";
import { personColors, SENTIMENT_COLORS, sentimentColor } from "../colors";
import { blendColors, drawEdgeSimple, drawEdgeDir } from "./graphDrawing";
import { PersonDetailModal, ConnectModal, HoverTooltip } from "./GraphModals";

interface GraphProps {
  people: Person[];
  selectedId: string | null;
  filterText: string;
  simplified?: boolean;
  onSelectPerson: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onUntangleRef?: React.MutableRefObject<(() => void) | null>;
  onLayoutSaved?: (positions: Record<string, { x: number; y: number }>) => void;
  onUpdated?: () => void;
}

export const Graph: React.FC<GraphProps> = ({
  people, selectedId, filterText, simplified = false, onSelectPerson, onDragEnd, onUntangleRef, onLayoutSaved, onUpdated,
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

        if (simplified) {
          // Simplified mode: single line, blended color, no label
          const colA = sentimentColor(rel.sentiment);
          const colB = reverse ? sentimentColor(reverse.sentiment) : colA;
          const blended = blendColors(colA, colB);
          drawEdgeSimple(edgesLayer, aPos, bPos, blended, dim ? 0.08 : 1, ns);
        } else {
          drawEdgeDir(edgesLayer, aPos, bPos, rel.label, sentimentColor(rel.sentiment), dim ? 0.08 : 1, ns, 1, person.id, rel.to_id);
          if (reverse) drawEdgeDir(edgesLayer, bPos, aPos, reverse.label, sentimentColor(reverse.sentiment), dim ? 0.08 : 1, ns, 1, rel.to_id, person.id);
        }
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
      const c = personColors(person.primary_tag || "", person.name);
      const isMe = person.primary_tag?.toLowerCase() === "me";
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
  }, [people, selectedId, filterText, simplified, onSelectPerson, resolveCollisions]);

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
      {connectModal && (
        <ConnectModal
          fromPerson={people.find(p => p.id === connectModal.fromId)}
          toPerson={people.find(p => p.id === connectModal.toId)}
          label={connectLabel}
          onLabelChange={setConnectLabel}
          sentiment={connectSentiment}
          onSentimentChange={setConnectSentiment}
          onConnect={async () => {
            if (!connectLabel.trim()) return;
            await api.createRelationship({ from_id: connectModal.fromId, to_id: connectModal.toId, label: connectLabel.trim(), sentiment: connectSentiment });
            setConnectModal(null); setConnectLabel(""); onUpdated?.();
          }}
          onCancel={() => setConnectModal(null)}
        />
      )}

      {/* Hover tooltip */}
      {tooltip && !draggingRef.current && (
        <HoverTooltip person={tooltip.person} x={tooltip.x} y={tooltip.y} />
      )}

      {/* Click modal */}
      {modal && (
        <PersonDetailModal person={modal} people={people} onClose={() => setModal(null)} />
      )}
    </div>
  );
};
