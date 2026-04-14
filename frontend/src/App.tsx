import React, { useState, useEffect, useCallback } from "react";
import { Person } from "./types";
import { api } from "./api";
import { Toolbar } from "./components/Toolbar";
import { Graph } from "./components/Graph";
import { ProfilePanel } from "./components/ProfilePanel";
import { AddPersonModal } from "./components/AddPersonModal";
import { MeSetupModal } from "./components/MeSetupModal";

function circleLayout(people: Person[], W: number, H: number): Record<string, { x: number; y: number }> {
  const n = people.length;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.36;
  const positions: Record<string, { x: number; y: number }> = {};
  people.forEach((p, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    positions[p.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return positions;
}

export default function App() {
  const untangleRef = React.useRef<(() => void) | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showMeSetup, setShowMeSetup] = React.useState(false);
  const initialLoadDone = React.useRef(false);

  const loadPeople = useCallback(async () => {
    try {
      const data = await api.getPeople();
      // Assign default positions for new people with x=0,y=0
      const unpositioned = data.filter(p => p.x === 0 && p.y === 0);
      if (unpositioned.length > 0) {
        const W = window.innerWidth - 280, H = window.innerHeight - 60;
        const positions = circleLayout(data, W, H);
        const updates = unpositioned.map(p =>
          api.saveLayout({ [p.id]: positions[p.id] })
        );
        await Promise.all(updates);
        const refreshed = await api.getPeople();
        setPeople(refreshed);
      } else {
        setPeople(data);
      }
      setError("");
    } catch (e: any) {
      setError("Cannot connect to backend. Make sure the FastAPI server is running on port 8000.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPeople(); }, [loadPeople]);

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

  const handleDragEnd = useCallback(async (id: string, x: number, y: number) => {
    try {
      await api.saveLayout({ [id]: { x, y } });
      setPeople(prev => prev.map(p => p.id === id ? { ...p, x, y } : p));
    } catch {}
  }, []);

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

  const handleLayoutSaved = async (positions: Record<string, { x: number; y: number }>) => {
    try {
      await api.saveLayout(positions);
      await loadPeople();
    } catch {}
  };

  const handleResetLayout = async () => {
    const W = window.innerWidth - 280, H = window.innerHeight - 60;
    const positions = circleLayout(people, W, H);
    await api.saveLayout(positions);
    await loadPeople();
  };

  const selectedPerson = people.find(p => p.id === selectedId) || null;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 14, color: "#888" }}>
      Loading...
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
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
      {error && (
        <div style={{ background: "#FCEBEB", color: "#E24B4A", padding: "8px 14px", fontSize: 13, borderBottom: "1px solid #f5c6c6" }}>
          {error}
        </div>
      )}
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
          />
        </div>
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
      {showMeSetup && (
        <MeSetupModal
          onConfirm={async (name: string) => {
            try {
              const W = window.innerWidth - 280, H = window.innerHeight - 60;
              await api.createPerson({ name, primary_tag: "me", x: W / 2, y: H / 2 });
              setShowMeSetup(false);
              await loadPeople();
            } catch (e: any) { alert(e.message); }
          }}
          onSkip={() => setShowMeSetup(false)}
        />
      )}
      {showAddModal && (
        <AddPersonModal
          onConfirm={handleAddPerson}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
