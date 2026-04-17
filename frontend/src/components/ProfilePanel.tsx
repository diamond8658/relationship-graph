import React, { useState, useEffect, useRef, useCallback } from "react";
import { Person, RelationshipData, Sentiment, Interest, TimelineEntry, Tag } from "../types";
import { api } from "../api";

const SENTIMENT_COLORS: Record<string, string> = {
  hates: '#7C0A02', dislikes: '#ff6e00', neutral: '#888780',
  likes: '#03c04a', loves: '#4b0082',
};
const SENTIMENTS: Sentiment[] = ['hates', 'dislikes', 'neutral', 'likes', 'loves'];

import { personColors } from "../colors";

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: "#aaa", textTransform: "uppercase" as const,
  letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: "4px 8px", border: "1px solid #ddd",
  borderRadius: 5, width: "100%", boxSizing: "border-box" as const, outline: "none",
};
const pill = (color: string, light?: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  fontSize: 11, padding: "2px 8px", borderRadius: 99,
  background: light ? color + "22" : color,
  color: light ? color : "#fff", fontWeight: 500,
  border: `1px solid ${color}33`,
});

// Parse natural language dates
function parseNaturalDate(input: string): string {
  const today = new Date();
  const s = input.trim().toLowerCase();
  if (s === "today") return today.toISOString().slice(0, 10);
  if (s === "yesterday") { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  if (s === "last week") { const d = new Date(today); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }
  if (s === "last month") { const d = new Date(today); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const dayIdx = days.indexOf(s);
  if (dayIdx !== -1) {
    const d = new Date(today);
    const diff = (today.getDay() - dayIdx + 7) % 7 || 7;
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  }
  // Try parsing as a date directly
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return today.toISOString().slice(0, 10);
}

interface ProfilePanelProps {
  person: Person;
  allPeople: Person[];
  onClose: () => void;
  onUpdated: () => void;
  onSelectPerson: (id: string) => void;
}

export const ProfilePanel: React.FC<ProfilePanelProps> = ({
  person, allPeople, onClose, onUpdated, onSelectPerson,
}) => {
  const [name, setName] = useState(person.name);
  const [primaryTag, setPrimaryTag] = useState(person.primary_tag || "");
  const [occupation, setOccupation] = useState(person.occupation || "");
  const [company, setCompany] = useState(person.company || "");
  const [location, setLocation] = useState(person.location || "");
  const [phone, setPhone] = useState(person.phone || "");
  const [email, setEmail] = useState(person.email || "");
  const [linkedin, setLinkedin] = useState(person.linkedin || "");
  const [birthday, setBirthday] = useState(person.birthday || "");
  const [twitter, setTwitter] = useState(person.twitter || "");
  const [instagram, setInstagram] = useState(person.instagram || "");
  const [github, setGithub] = useState(person.github || "");
  const [website, setWebsite] = useState(person.website || "");
  const [skills, setSkills] = useState(person.skills || "");
  const [photoUrl, setPhotoUrl] = useState(person.photo || "");
  const [description, setDescription] = useState(person.description || "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tags
  const [newTag, setNewTag] = useState("");
  const [editingPrimaryTag, setEditingPrimaryTag] = useState(false);

  // Timeline
  const [localTimeline, setLocalTimeline] = useState(person.timeline || []);
  const [newEntryDate, setNewEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [newEntryDateRaw, setNewEntryDateRaw] = useState("today");
  const [newEntryNote, setNewEntryNote] = useState("");
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  // Relationships
  const [relTarget, setRelTarget] = useState("");
  const [relTargetName, setRelTargetName] = useState("");
  const [relSearch, setRelSearch] = useState("");
  const [showRelDropdown, setShowRelDropdown] = useState(false);
  const [relActiveIdx, setRelActiveIdx] = useState(0);
  const [relLabel, setRelLabel] = useState("");
  const [relSentiment, setRelSentiment] = useState<Sentiment>("neutral");

  const c = personColors(person.primary_tag || "", person.name);
  const initials = person.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

  useEffect(() => {
    setName(person.name); setPrimaryTag(person.primary_tag || "");
    setOccupation(person.occupation || ""); setCompany(person.company || "");
    setLocation(person.location || ""); setPhone(person.phone || "");
    setEmail(person.email || ""); setLinkedin(person.linkedin || "");
    setBirthday(person.birthday || ""); setTwitter(person.twitter || "");
    setInstagram(person.instagram || ""); setGithub(person.github || "");
    setWebsite(person.website || ""); setSkills(person.skills || "");
    setPhotoUrl(person.photo || ""); setDescription(person.description || "");
    setLocalTimeline(person.timeline || []);
    setSaveStatus("idle");
    setEditingPrimaryTag(false);
  }, [person.id]);

  // Auto-save with debounce
  const autoSave = useCallback((fields: Partial<Person>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      try {
        await api.updatePerson(person.id, fields);
        setSaveStatus("saved");
        onUpdated();
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 800);
  }, [person.id, onUpdated]);

  const deletePerson = async () => {
    if (!window.confirm(`Delete ${person.name}?`)) return;
    await api.deletePerson(person.id);
    onUpdated(); onClose();
  };

  // Tags
  const addTag = async () => {
    if (!newTag.trim()) return;
    await api.addTag(person.id, newTag.trim());
    setNewTag(""); onUpdated();
  };

  // Timeline
  const addEntry = async () => {
    if (!newEntryNote.trim()) return;
    const resolvedDate = parseNaturalDate(newEntryDateRaw);
    const entry = await api.addTimelineEntry(person.id, resolvedDate, newEntryNote.trim());
    setLocalTimeline(prev => [entry, ...prev]);
    setNewEntryNote(""); setNewEntryDateRaw("today"); setNewEntryDate(new Date().toISOString().slice(0, 10));
    onUpdated();
  };

  const analyzeEntry = async (entry: TimelineEntry) => {
    setAnalyzing(entry.id);
    try {
      const res = await api.analyzeTimelineEntry(entry.id);
      if (res.count === 0 && (res as any).message) alert((res as any).message);
      else if (res.count === 0) alert("No likes or dislikes found in this note.");
      else onUpdated();
    } catch (e: any) { alert(e.message); }
    setAnalyzing(null);
  };

  const deleteEntry = async (entryId: string) => {
    setLocalTimeline(prev => prev.filter(e => e.id !== entryId));
    try { await api.deleteTimelineEntry(entryId); } catch {}
    onUpdated();
  };

  // Interests
  const confirmInterest = async (interest: Interest, confirmed: boolean) => {
    await api.confirmInterest(interest.id, confirmed); onUpdated();
  };
  const deleteInterest = async (interestId: string) => {
    await api.deleteInterest(interestId); onUpdated();
  };

  // Relationships
  const addRel = async () => {
    if (!relTarget || !relLabel.trim()) return;
    await api.createRelationship({ from_id: person.id, to_id: relTarget, label: relLabel.trim(), sentiment: relSentiment });
    setRelTarget(""); setRelTargetName(""); setRelSearch(""); setRelLabel(""); setRelSentiment("neutral"); onUpdated();
  };

  const updateRelLabel = async (rel: RelationshipData, newLabel: string) => {
    if (!newLabel.trim()) await api.deleteRelationship(rel.id);
    else await api.updateRelationship(rel.id, newLabel, rel.sentiment);
    onUpdated();
  };

  const updateRelSentiment = async (rel: RelationshipData, sentiment: string) => {
    await api.updateRelationship(rel.id, rel.label, sentiment); onUpdated();
  };

  const removeRel = async (relId: string) => {
    await api.deleteRelationship(relId); onUpdated();
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setPhotoUrl(url);
      autoSave({ photo: url });
    };
    reader.readAsDataURL(file);
  };

  const pendingInterests = person.interests.filter(i => !i.confirmed);
  const confirmedLikes = person.interests.filter(i => i.confirmed && i.type === "likes");
  const confirmedDislikes = person.interests.filter(i => i.confirmed && i.type === "dislikes");
  const allOtherIds = new Set([
    ...person.outgoing.map((r: RelationshipData) => r.to_id),
    ...person.incoming.map((r: RelationshipData) => r.from_id),
  ]);

  return (
    <div style={{ width: 270, height: "100%", background: "#fff", borderLeft: "1px solid #e0e0e0", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>

      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e0e0e0", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {person.photo ? (
          <img src={person.photo} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, background: c.light, color: c.fill }}>
            {initials}
          </div>
        )}
        <div style={{ display: "flex", gap: 5, width: "100%", alignItems: "center" }}>
          <label style={{ flex: 1 }}>
            <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <span style={{ display: "block", textAlign: "center", fontSize: 11, padding: "3px 0", background: "#f0f0f0", borderRadius: 5, cursor: "pointer", border: "1px solid #ddd" }}>Upload</span>
          </label>
          <button onClick={() => { const url = prompt("Photo URL:"); if (url) { setPhotoUrl(url); autoSave({ photo: url }); } }} style={{ flex: 1, fontSize: 11, background: "#f0f0f0", border: "1px solid #ddd", borderRadius: 5, cursor: "pointer", padding: "3px 0" }}>URL</button>
          {/* Save status indicator */}
          <div style={{ fontSize: 10, color: saveStatus === "saved" ? "#03c04a" : saveStatus === "saving" ? "#888" : "transparent", flexShrink: 0, minWidth: 40, textAlign: "right" }}>
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : ""}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Identity */}
        <div>
          <div style={sectionLabel}>Identity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input value={name} onChange={e => setName(e.target.value)} onBlur={() => autoSave({ name })} placeholder="Name" style={inputStyle} />
            <input value={occupation} onChange={e => setOccupation(e.target.value)} onBlur={() => autoSave({ occupation })} placeholder="Occupation" style={inputStyle} />
            <input value={company} onChange={e => setCompany(e.target.value)} onBlur={() => autoSave({ company })} placeholder="Company" style={inputStyle} />
            <input value={location} onChange={e => setLocation(e.target.value)} onBlur={() => autoSave({ location })} placeholder="Location" style={inputStyle} />
          </div>
        </div>

        {/* Contact */}
        <div>
          <div style={sectionLabel}>Contact</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => autoSave({ phone })} placeholder="Phone" style={inputStyle} />
            <input value={email} onChange={e => setEmail(e.target.value)} onBlur={() => autoSave({ email })} placeholder="Email" style={inputStyle} />
            <input value={linkedin} onChange={e => setLinkedin(e.target.value)} onBlur={() => autoSave({ linkedin })} placeholder="LinkedIn URL" style={inputStyle} />
            <input value={website} onChange={e => setWebsite(e.target.value)} onBlur={() => autoSave({ website })} placeholder="Website URL" style={inputStyle} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: 11, color: "#aaa", whiteSpace: "nowrap" }}>Birthday</label>
              <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} onBlur={() => autoSave({ birthday })} style={{ ...inputStyle, flex: 1 }} />
            </div>
          </div>
        </div>

        {/* Social */}
        <div>
          <div style={sectionLabel}>Social</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input value={twitter} onChange={e => setTwitter(e.target.value)} onBlur={() => autoSave({ twitter })} placeholder="Twitter / X" style={inputStyle} />
            <input value={instagram} onChange={e => setInstagram(e.target.value)} onBlur={() => autoSave({ instagram })} placeholder="Instagram" style={inputStyle} />
            <input value={github} onChange={e => setGithub(e.target.value)} onBlur={() => autoSave({ github })} placeholder="GitHub" style={inputStyle} />
          </div>
        </div>

        {/* Skills */}
        <div>
          <div style={sectionLabel}>Skills</div>
          <input value={skills} onChange={e => setSkills(e.target.value)} onBlur={() => autoSave({ skills })} placeholder="e.g. Python, design, public speaking" style={inputStyle} />
          <div style={{ fontSize: 10, color: "#aaa", marginTop: 3 }}>Comma-separated</div>
        </div>

        {/* Description */}
        <div>
          <div style={sectionLabel}>Description / Traits</div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} onBlur={() => autoSave({ description })} placeholder="Freeform notes, personality traits, anything without a date..." style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} />
        </div>

        {/* Tags */}
        <div>
          <div style={sectionLabel}>Tags</div>

          {/* Primary tag — displayed as a special badge, click to edit */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4 }}>Primary tag (drives node color)</div>
            {primaryTag && !editingPrimaryTag ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{ ...pill(c.fill), cursor: "pointer", fontSize: 12, padding: "3px 10px" }}
                  onClick={() => setEditingPrimaryTag(true)}
                  title="Click to change"
                >
                  ★ {primaryTag}
                </span>
                <span
                  style={{ fontSize: 10, color: "#aaa", cursor: "pointer" }}
                  onClick={() => { setPrimaryTag(""); autoSave({ primary_tag: "" }); }}
                >remove</span>
              </div>
            ) : editingPrimaryTag ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  autoFocus
                  value={primaryTag}
                  onChange={e => setPrimaryTag(e.target.value)}
                  onBlur={() => { setEditingPrimaryTag(false); autoSave({ primary_tag: primaryTag }); }}
                  onKeyDown={e => { if (e.key === "Enter") { setEditingPrimaryTag(false); autoSave({ primary_tag: primaryTag }); } if (e.key === "Escape") { setPrimaryTag(person.primary_tag || ""); setEditingPrimaryTag(false); } }}
                  placeholder="Primary tag..."
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingPrimaryTag(true)}
                style={{ fontSize: 11, padding: "3px 10px", background: "#f0f0f0", border: "1px dashed #ccc", borderRadius: 99, cursor: "pointer", color: "#aaa" }}
              >+ Set primary tag</button>
            )}
          </div>

          {/* Regular tags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {person.tags.map((tag: Tag) => (
              <span key={tag.id} style={{ ...pill("#378ADD", true), cursor: "pointer" }} onClick={() => api.deleteTag(tag.id).then(onUpdated)}>
                {tag.label} ✕
              </span>
            ))}
          </div>
          <input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => e.key === "Enter" && addTag()} placeholder="Add tag..." style={{ ...inputStyle }} />
        </div>

        {/* Interests */}
        <div>
          <div style={sectionLabel}>Interests</div>
          {pendingInterests.length > 0 && (
            <div style={{ background: "#FAEEDA", borderRadius: 6, padding: "6px 8px", marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#BA7517", fontWeight: 600, marginBottom: 4 }}>AI suggestions — confirm or dismiss:</div>
              {pendingInterests.map((i: Interest) => (
                <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                  <span style={pill(i.type === "likes" ? "#03c04a" : "#7C0A02", true)}>{i.type === "likes" ? "♥" : "✕"} {i.label}</span>
                  <button onClick={() => confirmInterest(i, true)} style={{ fontSize: 10, padding: "1px 6px", background: "#03c04a", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>✓</button>
                  <button onClick={() => deleteInterest(i.id)} style={{ fontSize: 10, padding: "1px 6px", background: "#7C0A02", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          )}
          {confirmedLikes.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: "#03c04a", fontWeight: 600, marginBottom: 3 }}>Likes</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {confirmedLikes.map((i: Interest) => (
                  <span key={i.id} style={{ ...pill("#03c04a", true), cursor: "pointer" }} onClick={() => deleteInterest(i.id)}>{i.label} ✕</span>
                ))}
              </div>
            </div>
          )}
          {confirmedDislikes.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#7C0A02", fontWeight: 600, marginBottom: 3 }}>Dislikes</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {confirmedDislikes.map((i: Interest) => (
                  <span key={i.id} style={{ ...pill("#7C0A02", true), cursor: "pointer" }} onClick={() => deleteInterest(i.id)}>{i.label} ✕</span>
                ))}
              </div>
            </div>
          )}
          {pendingInterests.length === 0 && confirmedLikes.length === 0 && confirmedDislikes.length === 0 && (
            <div style={{ fontSize: 11, color: "#aaa", fontStyle: "italic" }}>Add timeline entries to extract interests via AI</div>
          )}
        </div>

        {/* Timeline */}
        <div>
          <div style={sectionLabel}>Timeline</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="text"
                value={newEntryDateRaw}
                onChange={e => { setNewEntryDateRaw(e.target.value); setNewEntryDate(parseNaturalDate(e.target.value)); }}
                placeholder="today, yesterday, monday..."
                style={{ ...inputStyle, flex: 1 }}
                title={`Resolves to: ${newEntryDate}`}
              />
              <input
                type="date"
                value={newEntryDate}
                onChange={e => { setNewEntryDate(e.target.value); setNewEntryDateRaw(e.target.value); }}
                style={{ fontSize: 11, border: "1px solid #ddd", borderRadius: 5, padding: "2px 4px", cursor: "pointer", flexShrink: 0 }}
                title="Pick a date"
              />
            </div>
            <div style={{ fontSize: 10, color: "#aaa", marginTop: -2 }}>→ {newEntryDate}</div>
            <textarea
              value={newEntryNote}
              onChange={e => setNewEntryNote(e.target.value)}
              placeholder="Note... (press Enter to save)"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addEntry(); } }}
              style={{ ...inputStyle, minHeight: 52, resize: "vertical" }}
            />
            <button onClick={addEntry} style={{ fontSize: 11, padding: "4px 0", background: "#378ADD", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" }}>Add entry</button>
          </div>
          {localTimeline.slice().reverse().map((entry: TimelineEntry) => (
            <div key={entry.id} style={{ background: "#f7f7f7", borderRadius: 6, padding: "6px 8px", marginBottom: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: "#888", fontWeight: 600 }}>{entry.date}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => analyzeEntry(entry)} disabled={analyzing === entry.id} title="Generate suggestions" style={{ fontSize: 9, padding: "1px 5px", background: analyzing === entry.id ? "#ccc" : "#7F77DD", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>
                    {analyzing === entry.id ? "..." : "Generate suggestions"}
                  </button>
                  <button onClick={() => deleteEntry(entry.id)} style={{ fontSize: 9, padding: "1px 5px", background: "#f0f0f0", color: "#E24B4A", border: "none", borderRadius: 3, cursor: "pointer" }}>✕</button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#444", lineHeight: 1.4 }}>{entry.note}</div>
            </div>
          ))}
        </div>

        {/* Relationships */}
        <div>
          <div style={sectionLabel}>Relationships</div>
          {Array.from(allOtherIds).map(otherId => {
            const other = allPeople.find(p => p.id === otherId);
            if (!other) return null;
            const myRel = person.outgoing.find((r: RelationshipData) => r.to_id === otherId);
            const theirRel = person.incoming.find((r: RelationshipData) => r.from_id === otherId);
            return (
              <div key={otherId} style={{ background: "#f7f7f7", borderRadius: 6, padding: "6px 8px", marginBottom: 5, fontSize: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: "#378ADD", cursor: "pointer" }} onClick={() => onSelectPerson(otherId)}>{other.name}</span>
                  {myRel && <span style={{ fontSize: 10, color: "#E24B4A", cursor: "pointer" }} onClick={() => removeRel(myRel.id)}>remove</span>}
                </div>
                {myRel && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ color: "#888", flexShrink: 0 }}>→ you:</span>
                      <input defaultValue={myRel.label} onBlur={e => updateRelLabel(myRel, e.target.value)} style={{ flex: 1, fontSize: 11, border: "1px solid #ddd", borderRadius: 3, padding: "1px 5px" }} />
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ color: "#888", flexShrink: 0 }}>mood:</span>
                      <select value={myRel.sentiment || "neutral"} onChange={e => updateRelSentiment(myRel, e.target.value)}
                        style={{ flex: 1, fontSize: 11, border: `1px solid ${SENTIMENT_COLORS[myRel.sentiment || "neutral"]}`, borderRadius: 3, padding: "1px 4px", color: SENTIMENT_COLORS[myRel.sentiment || "neutral"], fontWeight: 600 }}>
                        {SENTIMENTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                {theirRel && (
                  <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
                    <span style={{ color: "#bbb", flexShrink: 0 }}>← them:</span>
                    <em style={{ fontSize: 11, color: "#aaa" }}>{theirRel.label}</em>
                  </div>
                )}
              </div>
            );
          })}

          {/* Quick add relationship */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {(() => {
              const relMatches = allPeople.filter(p => p.id !== person.id && p.name.toLowerCase().includes(relSearch.toLowerCase()));
              return (
                <>
                  <div style={{ position: "relative" }}>
                    <input
                      value={relSearch}
                      onChange={e => { setRelSearch(e.target.value); setRelTarget(""); setRelTargetName(""); setShowRelDropdown(true); setRelActiveIdx(0); }}
                      onFocus={() => setShowRelDropdown(true)}
                      onBlur={() => setTimeout(() => setShowRelDropdown(false), 150)}
                      onKeyDown={e => {
                        if (!showRelDropdown || relMatches.length === 0) return;
                        if (e.key === "ArrowDown") { e.preventDefault(); setRelActiveIdx(i => Math.min(i + 1, relMatches.length - 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setRelActiveIdx(i => Math.max(i - 1, 0)); }
                        else if (e.key === "Enter") {
                          e.preventDefault();
                          const p = relMatches[relActiveIdx];
                          if (p) { setRelTarget(p.id); setRelTargetName(p.name); setRelSearch(""); setShowRelDropdown(false);
                            // Auto-focus label field after selecting person
                            setTimeout(() => document.getElementById("rel-label-input")?.focus(), 50);
                          }
                        }
                        else if (e.key === "Escape") setShowRelDropdown(false);
                      }}
                      placeholder={relTargetName || "Search person to connect..."}
                      style={{ width: "100%", fontSize: 11, border: `1px solid ${relTarget ? "#378ADD" : "#ccc"}`, borderRadius: 4, padding: "3px 7px", boxSizing: "border-box" as const, color: relTargetName && !relSearch ? "#378ADD" : undefined, fontWeight: relTargetName && !relSearch ? 600 : undefined }}
                    />
                    {showRelDropdown && relSearch && (
                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50, maxHeight: 160, overflowY: "auto" }}>
                        {relMatches.map((p, idx) => (
                          <div key={p.id}
                            onMouseDown={() => { setRelTarget(p.id); setRelTargetName(p.name); setRelSearch(""); setShowRelDropdown(false); setTimeout(() => document.getElementById("rel-label-input")?.focus(), 50); }}
                            onMouseEnter={() => setRelActiveIdx(idx)}
                            style={{ padding: "5px 8px", fontSize: 11, cursor: "pointer", borderBottom: "1px solid #f0f0f0", background: idx === relActiveIdx ? "#E6F1FB" : "#fff", color: idx === relActiveIdx ? "#378ADD" : "#333" }}
                          >{p.name}{p.occupation ? ` — ${p.occupation}` : ""}</div>
                        ))}
                        {relMatches.length === 0 && <div style={{ padding: "5px 8px", fontSize: 11, color: "#aaa", fontStyle: "italic" }}>No matches</div>}
                      </div>
                    )}
                  </div>
                  <input
                    id="rel-label-input"
                    value={relLabel}
                    onChange={e => setRelLabel(e.target.value)}
                    placeholder="Your label for them"
                    onKeyDown={e => e.key === "Enter" && relTarget && addRel()}
                    style={{ fontSize: 11, border: "1px solid #ccc", borderRadius: 4, padding: "3px 5px" }}
                  />
                  <div style={{ display: "flex", gap: 4 }}>
                    <select value={relSentiment} onChange={e => setRelSentiment(e.target.value as Sentiment)}
                      style={{ flex: 1, fontSize: 11, border: `1px solid ${SENTIMENT_COLORS[relSentiment]}`, borderRadius: 4, padding: "3px 4px", color: SENTIMENT_COLORS[relSentiment], fontWeight: 600 }}>
                      {SENTIMENTS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                    <button onClick={addRel} disabled={!relTarget || !relLabel.trim()} style={{ flex: 1, fontSize: 11, padding: "3px 7px", background: relTarget && relLabel.trim() ? "#378ADD" : "#ccc", color: "#fff", border: "none", borderRadius: 4, cursor: relTarget && relLabel.trim() ? "pointer" : "default" }}>Add</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid #e0e0e0", display: "flex", gap: 6 }}>
        <button onClick={deletePerson} style={{ flex: 1, padding: "5px 0", background: "#FCEBEB", color: "#E24B4A", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Delete</button>
        <button onClick={onClose} style={{ flex: 2, padding: "5px 0", background: "#f0f0f0", color: "#444", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Close</button>
      </div>
    </div>
  );
};
