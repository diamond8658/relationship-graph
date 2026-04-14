import { Person, RelationshipData, TimelineEntry, Interest, Tag } from "./types";

// In packaged app the frontend is served as a file, backend is always localhost:8000
const BASE = "http://localhost:8000";

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
  // People
  getPeople: () => req<Person[]>("/people"),
  createPerson: (data: Partial<Person> & { name: string; x?: number; y?: number }) =>
    req<Person>("/people", { method: "POST", body: JSON.stringify(data) }),
  updatePerson: (id: string, data: Partial<Person>) =>
    req<Person>(`/people/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePerson: (id: string) =>
    req<{ ok: boolean }>(`/people/${id}`, { method: "DELETE" }),

  // Tags
  addTag: (personId: string, label: string) =>
    req<Tag>(`/people/${personId}/tags`, { method: "POST", body: JSON.stringify({ label }) }),
  deleteTag: (tagId: string) =>
    req<{ ok: boolean }>(`/tags/${tagId}`, { method: "DELETE" }),

  // Timeline
  getTimeline: (personId: string) =>
    req<TimelineEntry[]>(`/people/${personId}/timeline`),
  addTimelineEntry: (personId: string, date: string, note: string) =>
    req<TimelineEntry>(`/people/${personId}/timeline`, { method: "POST", body: JSON.stringify({ date, note }) }),
  deleteTimelineEntry: (entryId: string) =>
    req<{ ok: boolean }>(`/timeline/${entryId}`, { method: "DELETE" }),
  analyzeTimelineEntry: (entryId: string) =>
    req<{ suggestions: { type: string; label: string }[]; count: number }>(`/timeline/${entryId}/analyze`, { method: "POST" }),

  // Interests
  getInterests: (personId: string) =>
    req<Interest[]>(`/people/${personId}/interests`),
  confirmInterest: (interestId: string, confirmed: boolean) =>
    req<Interest>(`/interests/${interestId}/confirm`, { method: "PUT", body: JSON.stringify({ confirmed }) }),
  deleteInterest: (interestId: string) =>
    req<{ ok: boolean }>(`/interests/${interestId}`, { method: "DELETE" }),

  // Relationships
  createRelationship: (data: { from_id: string; to_id: string; label: string; sentiment?: string }) =>
    req<RelationshipData>("/relationships", { method: "POST", body: JSON.stringify(data) }),
  updateRelationship: (id: string, label: string, sentiment: string = "neutral") =>
    req<RelationshipData>(`/relationships/${id}`, { method: "PUT", body: JSON.stringify({ label, sentiment }) }),
  deleteRelationship: (id: string) =>
    req<{ ok: boolean }>(`/relationships/${id}`, { method: "DELETE" }),

  // Layout
  saveLayout: (positions: Record<string, { x: number; y: number }>) =>
    req<{ ok: boolean }>("/layout", { method: "PUT", body: JSON.stringify({ positions }) }),
};
