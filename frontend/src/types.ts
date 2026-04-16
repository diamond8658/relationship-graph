// ─────────────────────────────────────────────────────────────────────────────
// types.ts — Shared TypeScript interfaces for the Relationship Graph app.
// These mirror the Pydantic schemas in backend/schemas.py.
// ─────────────────────────────────────────────────────────────────────────────

// Sentiment levels for relationship arrows — drives arrow color on the canvas.
export type Sentiment = "hates" | "dislikes" | "neutral" | "likes" | "loves";

// A directional relationship from one person to another with a label and mood.
export interface RelationshipData {
  id: string;
  from_id: string;
  to_id: string;
  label: string;      // e.g. "Friend", "Colleague", "Mentor"
  sentiment: Sentiment;
}

// A freeform tag attached to a person (e.g. "work", "college", "family").
export interface Tag {
  id: string;
  label: string;
}

// A dated log entry on a person's timeline.
export interface TimelineEntry {
  id: string;
  date: string;   // ISO date string YYYY-MM-DD
  note: string;
}

// A like or dislike extracted from timeline notes, either pending AI review or confirmed.
export interface Interest {
  id: string;
  type: "likes" | "dislikes";
  label: string;       // e.g. "sushi", "loud music"
  confirmed: boolean;  // false = pending AI suggestion, true = user confirmed
  source_entry_id?: string;
}

// A person node in the graph with all their associated data.
export interface Person {
  id: string;
  name: string;
  primary_tag: string;    // Drives the node color on the canvas
  occupation: string;
  company: string;
  location: string;
  phone: string;
  email: string;
  linkedin: string;
  photo: string;          // Base64 data URL or remote URL
  description: string;    // Freeform traits/notes without a date
  birthday: string;       // ISO date string YYYY-MM-DD
  twitter: string;        // Twitter/X handle or URL
  instagram: string;      // Instagram handle or URL
  github: string;         // GitHub handle or URL
  website: string;        // Personal website URL
  skills: string;         // Comma-separated skill list
  x: number;              // Canvas X position (saved to DB)
  y: number;              // Canvas Y position (saved to DB)
  tags: Tag[];
  timeline: TimelineEntry[];
  interests: Interest[];
  outgoing: RelationshipData[];   // Relationships this person defines
  incoming: RelationshipData[];   // Relationships others define toward this person
}

// Used when saving node positions in bulk after a layout operation.
export interface NodePosition {
  x: number;
  y: number;
}
