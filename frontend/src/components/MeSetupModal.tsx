import React, { useState, useEffect, useRef } from "react";

interface MeSetupModalProps {
  onConfirm: (name: string) => void;
  onSkip: () => void;
}

export const MeSetupModal: React.FC<MeSetupModalProps> = ({ onConfirm, onSkip }) => {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 28, width: 320,
        boxShadow: "0 8px 40px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* Avatar placeholder */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "linear-gradient(135deg, #378ADD, #1D9E75)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28,
          }}>👤</div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 6 }}>
            Welcome to Relationship Graph
          </div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>
            Let's start by adding yourself. You'll be the anchor of your graph.
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>
            Your name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && name.trim() && onConfirm(name.trim())}
            placeholder="e.g. Justin Cheng"
            style={{
              width: "100%", fontSize: 14, padding: "8px 12px",
              border: "1px solid #ddd", borderRadius: 8, outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            style={{
              flex: 2, padding: "9px 0", background: name.trim() ? "#378ADD" : "#ccc",
              color: "#fff", border: "none", borderRadius: 8,
              cursor: name.trim() ? "pointer" : "default",
              fontSize: 14, fontWeight: 600,
            }}
          >
            Create my node
          </button>
          <button
            onClick={onSkip}
            style={{
              flex: 1, padding: "9px 0", background: "#f0f0f0",
              color: "#888", border: "none", borderRadius: 8,
              cursor: "pointer", fontSize: 13,
            }}
          >
            Skip
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#bbb", textAlign: "center" }}>
          Your node will be tagged "me" and centered on the canvas
        </div>
      </div>
    </div>
  );
};
