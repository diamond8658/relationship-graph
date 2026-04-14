// ─────────────────────────────────────────────────────────────────────────────
// App.tsx — Root component. Owns global state (people, selected node, modals)
// and wires all child components together.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from "react";
import { Person } from "./types";
import { api } from "./api";
import { Toolbar } from "./components/Toolbar";
import { Graph } from "./components/Graph";
import { ProfilePanel } from "./components/ProfilePanel";
import { AddPersonModal } from "./components/AddPersonModal";
import { MeSetupModal } from "./components/MeSetupModal";

// ── Layout helpers ────────────────────────────────────────────────────────────

// Place people evenly around a circle — used for initial load when positions are unset.
function circleLayout(
  people: Person[],
  W: number,
  H: number
): Record<string, { x: number; y: number }> {
  const n = people.length;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.36;
  const positions: Record<string, { x: number; y: number }> = {};
  people.forEach((p, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    positions[p.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return positions;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const untangleRef = React.useRef<(() => void) | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMeSetup, setShowMeSetup] = React.useState(false);
  const firstLoadDone = React.useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadPeople = useCallback(async () => {
    try {
      const data = await api.getPeople();

      // Assign circle positions to any nodes that haven't been placed yet.
      const unpositioned = data.filter(p => p.x === 0 && p.y === 0);
      if (unpositioned.length > 0) {
        const W = window.innerWidth - 280, H = window.innerHeight - 60;
        const positions = circleLayout(data, W, H);
        await Promise.all(unpositioned.map(p => api.saveLayout({ [p.id]: positions[p.id] })));
        const refreshed = await api.getPeople();
        setPeople(refreshed);
      } else {
        setPeople(data);
      }
      setError("");

      // Only check for Me node on the very first load, not on every refresh.
      if (!firstLoadDone.current) {
        firstLoadDone.current = true;
        const alreadyDismissed = sessionStorage.getItem("me-setup-dismissed");
        const hasMeNode = data.some((p: any) => p.primary_tag?.toLowerCase() === "me");
        if (!hasMeNode && !alreadyDismissed) {
          setShowMeSetup(true);
        }
      }
    } catch (e: any) {
      setError("Cannot connect to backend. Make sure the FastAPI server is running on port 8000.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  // ── Event handlers ─────────────────────────────────────────────────────────

  // Create a new person and place it near the canvas center.
  const handleAddPerson = async (name: string, _group: string) => {
    const W = window.innerWidth - 280, H = window.innerHeight - 60;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.min(W, H) * 0.3;
    try {
      const person = await api.createPerson({
        name,
        x: W / 2 + r * Math.cos(angle),
        y: H / 2 + r * Math.sin(angle),
      });
      setShowAddModal(false);
      await loadPeople();
      setSelectedId(person.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Save a single node's position after dragging.
  const handleDragEnd = useCallback(async (id: string, x: number, y: number) => {
    try {
      await api.saveLayout({ [id]: { x, y } });
      setPeople(prev => prev.map(p => p.id === id ? { ...p, x, y } : p));
    } catch {}
  }, []);

  // Save all positions after the sort/untangle algorithm finishes, then reload.
  const handleLayoutSaved = async (positions: Record<string, { x: number; y: number }>) => {
    try {
      await api.saveLayout(positions);
      await loadPeople();
    } catch {}
  };

  // Reset all nodes to a fresh circle layout.
  const handleResetLayout = async () => {
    const W = window.innerWidth - 280, H = window.innerHeight - 60;
    const positions = circleLayout(people, W, H);
    await api.saveLayout(positions);
    await loadPeople();
  };

  // Trigger a JSON download of the full graph data from the export endpoint.
  const handleExport = async () => {
    try {
      const res = await fetch("http://localhost:8000/export");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relationship-graph-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Export failed: " + e.message);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const selectedPerson = people.find(p => p.id === selectedId) || null;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 14, color: "#888" }}>
      Loading...
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* Top toolbar — search, add, refresh, sort, export */}
      <Toolbar
        search={filterText}
        onSearch={setFilterText}
        onAddPerson={() => setShowAddModal(true)}
        onResetLayout={handleResetLayout}
        onRefresh={loadPeople}
        onUntangle={() => untangleRef.current && untangleRef.current()}
        onExport={handleExport}
        people={people}
        onSelectPerson={setSelectedId}
      />

      {/* Backend connection error banner */}
      {error && (
        <div style={{ background: "#FCEBEB", color: "#E24B4A", padding: "8px 14px", fontSize: 13, borderBottom: "1px solid #f5c6c6" }}>
          {error}
        </div>
      )}

      {/* Main content — graph canvas + optional profile panel sidebar */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <Graph
            people={people}
            selectedId={selectedId}
            filterText={filterText}
            onSelectPerson={setSelectedId}
            onDragEnd={handleDragEnd}
            onUntangleRef={untangleRef}
            onLayoutSaved={handleLayoutSaved}
            onUpdated={loadPeople}
          />
        </div>

        {/* Profile edit panel — slides in when a node is selected */}
        {selectedPerson && (
          <ProfilePanel
            person={selectedPerson}
            allPeople={people}
            onClose={() => setSelectedId(null)}
            onUpdated={loadPeople}
            onSelectPerson={setSelectedId}
          />
        )}
      </div>

      {/* First-run welcome modal — prompts user to create their "Me" node */}
      {showMeSetup && (
        <MeSetupModal
          onConfirm={async (name: string) => {
            try {
              const W = window.innerWidth - 280, H = window.innerHeight - 60;
              await api.createPerson({ name, primary_tag: "me", x: W / 2, y: H / 2 });
              sessionStorage.removeItem("me-setup-dismissed");
              setShowMeSetup(false);
              await loadPeople();
            } catch (e: any) { alert(e.message); }
          }}
          onSkip={() => { sessionStorage.setItem("me-setup-dismissed", "1"); setShowMeSetup(false); }}
        />
      )}

      {/* Add person modal */}
      {showAddModal && (
        <AddPersonModal
          onConfirm={handleAddPerson}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
