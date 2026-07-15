// ─────────────────────────────────────────────────────────────────────────────
// GraphModals.tsx — Presentational pieces extracted from Graph.tsx: the
// person-detail modal (click a node), the drag-to-connect modal (shift+drag
// between two nodes), and the hover tooltip. All pure props-in/JSX-out —
// no shared refs with the canvas rendering/drag logic that stays in Graph.tsx.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { Person } from "../types";
import { SENTIMENT_COLORS, SENTIMENTS } from "../colors";

// ── Relationships list (collapsible) — shown inside PersonDetailModal ────────

export const RelationshipsList: React.FC<{ modal: any; people: any[] }> = ({ modal, people }) => {
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
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: SENTIMENT_COLORS[rel.sentiment] || "#888", flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12, color: "#555", lineHeight: 1.4 }}>
                <strong style={{ color: "#222" }}>{modal.name}</strong> sees <strong style={{ color: "#222" }}>{people.find((p: any) => p.id === rel.to_id)?.name || rel.to_id}</strong> as <em>"{rel.label}"</em>
              </span>
            </div>
          ))}
          {modal.incoming.map((rel: any) => (
            <div key={rel.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: SENTIMENT_COLORS[rel.sentiment] || "#888", flexShrink: 0, opacity: 0.5, marginTop: 2 }} />
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

// ── Person detail modal — shown on single-click of a node ────────────────────

export const PersonDetailModal: React.FC<{
  person: Person;
  people: Person[];
  onClose: () => void;
}> = ({ person: modal, people, onClose }) => {
  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}
      onClick={onClose}
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
          <RelationshipsList modal={modal} people={people} />
        )}

        <button
          onClick={onClose}
          style={{ marginTop: 16, width: "100%", padding: "8px 0", background: "#f0f0f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#444" }}
        >Close</button>
      </div>
    </div>
  );
};

// ── Drag-to-connect modal — shown after shift-dragging from one node to another ─

export const ConnectModal: React.FC<{
  fromPerson: Person | undefined;
  toPerson: Person | undefined;
  label: string;
  onLabelChange: (v: string) => void;
  sentiment: string;
  onSentimentChange: (v: string) => void;
  onConnect: () => void;
  onCancel: () => void;
}> = ({ fromPerson, toPerson, label, onLabelChange, sentiment, onSentimentChange, onConnect, onCancel }) => {
  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 10 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#222" }}>
          Connect <span style={{ color: "#378ADD" }}>{fromPerson?.name}</span> → <span style={{ color: "#378ADD" }}>{toPerson?.name}</span>
        </div>
        <input
          autoFocus
          value={label}
          onChange={e => onLabelChange(e.target.value)}
          placeholder="Label (e.g. Friend, Colleague)"
          onKeyDown={e => {
            if (e.key === "Enter" && label.trim()) onConnect();
            if (e.key === "Escape") onCancel();
          }}
          style={{ fontSize: 13, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, outline: "none" }}
        />
        <select value={sentiment} onChange={e => onSentimentChange(e.target.value)}
          style={{ fontSize: 13, padding: "5px 8px", border: `1px solid ${SENTIMENT_COLORS[sentiment]}`, borderRadius: 6, color: SENTIMENT_COLORS[sentiment], fontWeight: 600 }}>
          {SENTIMENTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onConnect} style={{ flex: 2, padding: "6px 0", background: label.trim() ? "#378ADD" : "#ccc", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 }}>Connect</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "6px 0", background: "#f0f0f0", color: "#444", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>Cancel</button>
        </div>
        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center" }}>Press Enter to connect, Escape to cancel</div>
      </div>
    </div>
  );
};

// ── Hover tooltip ──────────────────────────────────────────────────────────────

export const HoverTooltip: React.FC<{ person: Person; x: number; y: number }> = ({ person, x, y }) => (
  <div style={{
    position: "absolute",
    left: x + 16,
    top: y - 8,
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
    <div style={{ fontWeight: 600, color: "#222", marginBottom: 2 }}>{person.name}</div>
    <div style={{ color: "#888", fontSize: 11, marginBottom: person.occupation ? 4 : 0 }}>{person.primary_tag || person.occupation || ""}</div>
    {person.occupation && <div style={{ color: "#444", lineHeight: 1.4 }}>{person.occupation}{person.company ? ` @ ${person.company}` : ""}</div>}
  </div>
);
