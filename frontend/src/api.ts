// ─────────────────────────────────────────────────────────────────────────────
// api.ts — All HTTP calls to the FastAPI backend.
//
// Base URL is resolved once, lazily, and cached:
//   - Inside the Tauri shell, the backend runs on a port chosen dynamically
//     at launch (see src-tauri/src/main.rs) — we ask for it via the
//     `get_backend_port` command instead of hardcoding a port here.
//   - Outside Tauri (e.g. `npm run dev` open directly in a browser tab, with
//     the backend started manually via `uvicorn main:app --reload`), there's
//     no Tauri bridge to ask, so we fall back to DEFAULT_PORT.
// ─────────────────────────────────────────────────────────────────────────────

import { Person, RelationshipData, TimelineEntry, Interest, Tag } from "./types";

const DEFAULT_PORT = 8000;

let cachedBase: string | null = null;
let baseResolution: Promise<string> | null = null;

async function resolveBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (baseResolution) return baseResolution;

  baseResolution = (async () => {
    // window.__TAURI_INTERNALS__ only exists when running inside the Tauri
    // shell — a plain browser tab (or a future non-Tauri deployment) won't
    // have it, so this stays a no-op fallback rather than an error.
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const port = await invoke<number>("get_backend_port");
        cachedBase = `http://127.0.0.1:${port}`;
        return cachedBase;
      } catch {
        // Fall through to the default below — better to try the fixed
        // port than to hard-fail the whole app over this.
      }
    }
    cachedBase = `http://127.0.0.1:${DEFAULT_PORT}`;
    return cachedBase;
  })();

  return baseResolution;
}

// Generic fetch wrapper — throws on non-OK responses with the backend's detail message.
async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await resolveBase();
  const res = await fetch(`${base}${path}`, {
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

  // ── Export / Import / Backup ─────────────────────────────────────────────────
  // These used to be raw fetch() calls duplicated directly in App.tsx, each
  // re-hardcoding the backend URL — moved here so there's exactly one place
  // that knows how to reach the backend.

  getExport: () => req<any>("/export"),

  importGraph: (payload: any) =>
    req<{ ok: boolean; people: number }>("/import", {
      method: "POST", body: JSON.stringify(payload),
    }),

  getBackupPath: () => req<{ path: string }>("/backup-path"),
};
