export type Sentiment = "hates" | "dislikes" | "neutral" | "likes" | "loves";

export interface RelationshipData {
  id: string;
  from_id: string;
  to_id: string;
  label: string;
  sentiment: Sentiment;
}

export interface Tag {
  id: string;
  label: string;
}

export interface TimelineEntry {
  id: string;
  date: string;
  note: string;
}

export interface Interest {
  id: string;
  type: "likes" | "dislikes";
  label: string;
  confirmed: boolean;
  source_entry_id?: string;
}

export interface Person {
  id: string;
  name: string;
  primary_tag: string;
  occupation: string;
  company: string;
  location: string;
  phone: string;
  email: string;
  linkedin: string;
  photo: string;
  description: string;
  x: number;
  y: number;
  tags: Tag[];
  timeline: TimelineEntry[];
  interests: Interest[];
  outgoing: RelationshipData[];
  incoming: RelationshipData[];
}

export interface NodePosition {
  x: number;
  y: number;
}
