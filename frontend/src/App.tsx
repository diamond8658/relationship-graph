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
  const [simplified, setSimplified] = useState(false);
  // Hash of graph state at last export — used to detect unsaved changes
  const lastExportHashRef = React.useRef<string | null>(null);
  const [backupPath, setBackupPath] = React.useState<string>("");

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
      // Initialise export hash and backup path on first load
      if (!lastExportHashRef.current) {
        try {
          const exportData = await api.getExport();
          lastExportHashRef.current = graphHash(exportData.people || []);
        } catch {}
        try {
          const pathData = await api.getBackupPath();
          setBackupPath(pathData.path || "");
        } catch {}
      }

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
      setError("Cannot connect to backend. Make sure the FastAPI server is running.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  // ── Event handlers ─────────────────────────────────────────────────────────

  // Create a new person and place it near the canvas center.
  const handleAddPerson = async (name: string, group: string) => {
    const W = window.innerWidth - 280, H = window.innerHeight - 60;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.min(W, H) * 0.3;
    try {
      const person = await api.createPerson({
        name,
        primary_tag: group || undefined,
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

  // Fast, deterministic string hash (cyrb53-style). Not cryptographic —
  // just needs to be collision-resistant enough to catch real content
  // changes, and cheap to run on every load without hashing megabytes of
  // base64 photo data as a giant string comparison.
  const fastHash = (str: string): string => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };

  // Compute a hash of the current graph for "unsaved changes" detection.
  //
  // The previous version only fingerprinted name + primary_tag + outgoing
  // edge *count* — it missed changes to descriptions, photos, timeline
  // entries, tags, profile fields, and (critically) relationship label/
  // sentiment edits, since only the count of edges was hashed, not their
  // content. That meant editing a relationship from "Friend" to "Ex" and
  // then resetting/importing over the graph would skip the safety-net
  // export prompt entirely, silently discarding the edit.
  //
  // Canvas x/y position is intentionally excluded: positions are already
  // continuously auto-saved via /layout and aren't the kind of change this
  // "back up before you lose it" prompt is meant to protect — including
  // them would nag on every drag.
  const graphHash = (data: any[]): string => {
    const sig = data
      .map(p => {
        const tags = (p.tags ?? []).map((t: any) => t.label).sort().join(";");
        const timeline = (p.timeline ?? [])
          .map((e: any) => `${e.date}:${e.note}`)
          .sort()
          .join(";");
        const interests = (p.interests ?? [])
          .map((i: any) => `${i.type}:${i.label}:${i.confirmed}`)
          .sort()
          .join(";");
        const relationships = (p.relationships ?? p.outgoing ?? [])
          .map((r: any) => `${r.to_id}:${r.label}:${r.sentiment}`)
          .sort()
          .join(";");
        return [
          p.name, p.primary_tag, p.occupation, p.company, p.location,
          p.phone, p.email, p.linkedin, p.description, p.birthday,
          p.twitter, p.instagram, p.github, p.website, p.skills,
          p.photo?.length ?? 0, // length, not full base64 — avoids hashing megabytes per photo
          tags, timeline, interests, relationships,
        ].join("|");
      })
      .sort()
      .join(",");
    return fastHash(`${data.length}:${sig}`);
  };

  // Returns true if the user confirms they want to proceed despite unsaved changes.
  // If no changes since last export, returns true immediately without prompting.
  const confirmIfUnsaved = async (): Promise<boolean> => {
    try {
      const data = await api.getExport();
      const currentHash = graphHash(data.people || []);

      // No changes since last export — proceed silently
      if (lastExportHashRef.current === currentHash) return true;

      // Changes detected — ask user what to do
      const pathNote = backupPath ? `\n\nAuto-backups are saved to:\n${backupPath}` : "";
      const choice = window.confirm(
        "You have changes since your last export.\n\n" +
        "Click OK to export a backup before continuing, or Cancel to continue without exporting." +
        pathNote
      );

      if (choice) {
        // Export backup then proceed
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `relationship-graph-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
        a.click();
        URL.revokeObjectURL(url);
        lastExportHashRef.current = currentHash;
      }
      return true; // proceed either way
    } catch {
      return true; // if we can't check, just proceed
    }
  };

  // Trigger a JSON download of the full graph data from the export endpoint.
  const handleExport = async () => {
    try {
      const data = await api.getExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relationship-graph-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      // Track the exported state so we can detect changes later
      lastExportHashRef.current = graphHash(data.people || []);
    } catch (e: any) {
      alert("Export failed: " + e.message);
    }
  };

  // Load a graph from a JSON export file.
  const handleImport = async () => {
    // Check for unsaved changes first — prompts export if needed
    const proceed = await confirmIfUnsaved();
    if (!proceed) return;

    // Open file picker
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        await api.importGraph(payload);
        await loadPeople();
        setSelectedId(null);
      } catch (e: any) {
        alert("Import failed: " + e.message);
      }
    };
    input.click();
  };

  // Wipe the entire graph — backend auto-saves a backup first, then clears.
  const handleNewGraph = async () => {
    // Check for unsaved changes first — prompts export if needed
    const proceed = await confirmIfUnsaved();
    if (!proceed) return;

    const pathMsg = backupPath ? `\n\nAuto-backups are saved to:\n${backupPath}` : "";
    if (!window.confirm("This will clear your entire graph. A backup will be saved automatically before wiping." + pathMsg + "\n\nContinue?")) return;

    try {
      // POST empty graph to /import — backend saves a timestamped backup
      // to the user data directory before wiping, no download dialog needed.
      await api.importGraph({ version: 1, exported_at: new Date().toISOString(), people: [] });
      await loadPeople();
      setSelectedId(null);
      sessionStorage.removeItem("me-setup-dismissed");
      setShowMeSetup(true);
    } catch (e: any) {
      alert("Failed to reset graph: " + e.message);
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
        simplified={simplified}
        onToggleSimplified={() => setSimplified(s => !s)}
        onImport={handleImport}
        onNewGraph={handleNewGraph}
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
            simplified={simplified}
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
