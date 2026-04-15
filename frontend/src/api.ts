// ─────────────────────────────────────────────────────────────────────────────
// api.ts — All HTTP calls to the FastAPI backend.
// Base URL always points to localhost:8000 whether running in dev or packaged.
// ─────────────────────────────────────────────────────────────────────────────

import { Person, RelationshipData, TimelineEntry, Interest, Tag } from "./types";

const BASE = "http://127.0.0.1:8000";

// Generic fetch wrapper — throws on non-OK responses with the backend's detail message.
async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  // ── People ──────────────────────────────────────────────────────────────────

  // Fetch all people with their tags, timeline, interests, and relationships.
  getPeople: () => req<Person[]>("/people"),

  // Create a new person — x/y set their initial canvas position.
  createPerson: (data: Partial<Person> & { name: string; x?: number; y?: number }) =>
    req<Person>("/people", { method: "POST", body: JSON.stringify(data) }),

  // Partial update — only sends changed fields.
  updatePerson: (id: string, data: Partial<Person>) =>
    req<Person>(`/people/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deletePerson: (id: string) =>
    req<{ ok: boolean }>(`/people/${id}`, { method: "DELETE" }),

  // ── Tags ────────────────────────────────────────────────────────────────────

  // Add a tag to a person by label (lowercased on the backend, deduped).
  addTag: (personId: string, label: string) =>
    req<Tag>(`/people/${personId}/tags`, { method: "POST", body: JSON.stringify({ label }) }),

  deleteTag: (tagId: string) =>
    req<{ ok: boolean }>(`/tags/${tagId}`, { method: "DELETE" }),

  // ── Timeline ────────────────────────────────────────────────────────────────

  getTimeline: (personId: string) =>
    req<TimelineEntry[]>(`/people/${personId}/timeline`),

  addTimelineEntry: (personId: string, date: string, note: string) =>
    req<TimelineEntry>(`/people/${personId}/timeline`, {
      method: "POST", body: JSON.stringify({ date, note }),
    }),

  deleteTimelineEntry: (entryId: string) =>
    req<{ ok: boolean }>(`/timeline/${entryId}`, { method: "DELETE" }),

  // Calls the AI endpoint to extract likes/dislikes from a timeline note.
  // Returns { suggestions, count } — count = 0 if AI is not configured.
  analyzeTimelineEntry: (entryId: string) =>
    req<{ suggestions: { type: string; label: string }[]; count: number }>(
      `/timeline/${entryId}/analyze`, { method: "POST" }
    ),

  // ── Interests ───────────────────────────────────────────────────────────────

  getInterests: (personId: string) =>
    req<Interest[]>(`/people/${personId}/interests`),

  // Confirm or reject an AI-suggested interest.
  confirmInterest: (interestId: string, confirmed: boolean) =>
    req<Interest>(`/interests/${interestId}/confirm`, {
      method: "PUT", body: JSON.stringify({ confirmed }),
    }),

  deleteInterest: (interestId: string) =>
    req<{ ok: boolean }>(`/interests/${interestId}`, { method: "DELETE" }),

  // ── Relationships ────────────────────────────────────────────────────────────

  // Create or update a relationship (upserts on from_id + to_id).
  createRelationship: (data: { from_id: string; to_id: string; label: string; sentiment?: string }) =>
    req<RelationshipData>("/relationships", { method: "POST", body: JSON.stringify(data) }),

  updateRelationship: (id: string, label: string, sentiment: string = "neutral") =>
    req<RelationshipData>(`/relationships/${id}`, {
      method: "PUT", body: JSON.stringify({ label, sentiment }),
    }),

  deleteRelationship: (id: string) =>
    req<{ ok: boolean }>(`/relationships/${id}`, { method: "DELETE" }),

  // ── Layout ───────────────────────────────────────────────────────────────────

  // Batch save all node positions in one API call (used after drag or sort).
  saveLayout: (positions: Record<string, { x: number; y: number }>) =>
    req<{ ok: boolean }>("/layout", {
      method: "PUT", body: JSON.stringify({ positions }),
    }),
};
