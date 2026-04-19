import React, { useState, useRef, useEffect } from "react";
import { Person } from "../types";

interface ToolbarProps {
  search: string;
  onSearch: (val: string) => void;
  onAddPerson: () => void;
  onResetLayout: () => void;
  onRefresh: () => void;
  onUntangle: () => void;
  onExport: () => void;
  people: Person[];
  onSelectPerson: (id: string) => void;
  simplified: boolean;
  onToggleSimplified: () => void;
  onImport: () => void;
  onNewGraph: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  search, onSearch, onAddPerson, onResetLayout, onRefresh, onUntangle, onExport, people, onSelectPerson, simplified, onToggleSimplified, onImport, onNewGraph,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = search.trim()
    ? people.filter(p => {
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.primary_tag?.toLowerCase().includes(q) ||
          p.occupation?.toLowerCase().includes(q) ||
          p.tags?.some((t: any) => t.label.toLowerCase().includes(q))
        );
      })
    : [];

  useEffect(() => {
    setActiveIdx(0);
    setShowDropdown(matches.length > 0);
  }, [search, matches.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectPerson = (person: Person) => {
    onSelectPerson(person.id);
    onSearch("");
    setShowDropdown(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || matches.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Single match — auto-select; multiple — select active index
      const target = matches.length === 1 ? matches[0] : matches[activeIdx];
      if (target) selectPerson(target);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      onSearch("");
    }
  };

  return (
    <div style={{
      display: "flex", gap: 8, padding: "8px 12px",
      borderBottom: "1px solid #e0e0e0", alignItems: "center",
      flexWrap: "wrap", flexShrink: 0, background: "#fff",
    }}>
      {/* Search with dropdown */}
      <div ref={wrapRef} style={{ flex: 1, minWidth: 120, position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search people..."
          value={search}
          onChange={e => onSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (matches.length > 0) setShowDropdown(true); }}
          style={{
            width: "100%", fontSize: 13, padding: "4px 10px",
            border: "1px solid #ccc", borderRadius: 6, outline: "none",
            boxSizing: "border-box",
          }}
        />
        {showDropdown && matches.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
            background: "#fff", border: "1px solid #ddd", borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)", marginTop: 2,
            maxHeight: 200, overflowY: "auto",
          }}>
            {matches.map((person, idx) => (
              <div
                key={person.id}
                onMouseDown={() => selectPerson(person)}
                onMouseEnter={() => setActiveIdx(idx)}
                style={{
                  padding: "7px 12px", fontSize: 13, cursor: "pointer",
                  background: idx === activeIdx ? "#E6F1FB" : "#fff",
                  color: idx === activeIdx ? "#378ADD" : "#333",
                  display: "flex", alignItems: "center", gap: 8,
                  borderBottom: idx < matches.length - 1 ? "1px solid #f0f0f0" : "none",
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: "#378ADD", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 600, flexShrink: 0,
                }}>
                  {person.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{person.name}</div>
                  {(person.occupation || person.primary_tag || person.tags?.length > 0) && (
                    <div style={{ fontSize: 11, color: "#888" }}>
                      {[person.primary_tag, person.occupation, ...(person.tags?.map((t: any) => t.label) || [])].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                {matches.length === 1 && (
                  <div style={{ marginLeft: "auto", fontSize: 10, color: "#aaa" }}>Enter ↵</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={onAddPerson} style={btnStyle("#378ADD")}>+ Add person</button>
      <button onClick={onRefresh} style={btnStyle("#888")} title="Refresh">↻</button>
      <button onClick={onResetLayout} style={btnStyle("#888")} title="Reset layout">⊙</button>
      <button onClick={onUntangle} style={btnStyle("#7F77DD")} title="Untangle layout">⇌ Sort</button>
      <button onClick={onToggleSimplified} style={btnStyle(simplified ? "#D85A30" : "#888")} title={simplified ? "Switch to detailed view" : "Switch to simplified view"}>
        {simplified ? "⊞ Detail" : "⊟ Simple"}
      </button>
      {/* File dropdown — New, Load, Export */}
      <div ref={fileMenuRef} style={{ position: "relative" }}>
        <button
          onClick={() => setShowFileMenu(o => !o)}
          style={btnStyle("#1D9E75")}
          title="File options"
        >
          File ▾
        </button>
        {showFileMenu && (
          <div style={{
            position: "absolute", top: "100%", right: 0, zIndex: 200,
            background: "#fff", border: "1px solid #ddd", borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)", marginTop: 4,
            minWidth: 160, overflow: "hidden",
          }}>
            {[
              { label: "✦ New Graph", color: "#E24B4A", action: () => { onNewGraph(); setShowFileMenu(false); } },
              { label: "↑ Load Graph", color: "#BA7517", action: () => { onImport(); setShowFileMenu(false); } },
              { label: "↓ Export Graph", color: "#1D9E75", action: () => { onExport(); setShowFileMenu(false); } },
            ].map((item, i, arr) => (
              <div
                key={item.label}
                onMouseDown={item.action}
                style={{
                  padding: "9px 14px", fontSize: 13, cursor: "pointer",
                  color: item.color, fontWeight: 500,
                  borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none",
                  display: "flex", alignItems: "center", gap: 8,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f7f7f7")}
                onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function btnStyle(color: string) {
  return {
    fontSize: 12, padding: "4px 12px", background: color,
    color: "#fff", border: "none", borderRadius: 6,
    cursor: "pointer", fontWeight: 500, flexShrink: 0,
  } as React.CSSProperties;
}
