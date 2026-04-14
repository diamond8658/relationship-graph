import React, { useState, useEffect, useRef } from "react";

interface AddPersonModalProps {
  onConfirm: (name: string, group: string) => void;
  onClose: () => void;
}

export const AddPersonModal: React.FC<AddPersonModalProps> = ({ onConfirm, onClose }) => {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleConfirm = () => {
    if (!name.trim()) return;
    onConfirm(name.trim(), group.trim() || "other");
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#fff", borderRadius: 10, padding: 20, width: 280,
        display: "flex", flexDirection: "column", gap: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#222" }}>Add person</h3>
        <input
          ref={nameRef}
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Group (e.g. work, family, friend)"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          style={inputStyle}
        />
        {name.trim() && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#666" }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", background: "#E6F1FB",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, color: "#378ADD",
            }}>
              {name.trim().split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <span>{name.trim()}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleConfirm} style={{
            flex: 1, padding: "6px 0", background: "#378ADD", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500, fontSize: 13,
          }}>Create</button>
          <button onClick={onClose} style={{
            flex: 1, padding: "6px 0", background: "#f0f0f0", color: "#444",
            border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13,
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: "6px 10px",
  border: "1px solid #ccc", borderRadius: 6, outline: "none", width: "100%",
  boxSizing: "border-box",
};
