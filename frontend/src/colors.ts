// ─────────────────────────────────────────────────────────────────────────────
// colors.ts — Shared color palette and group color assignment.
// Both Graph.tsx and ProfilePanel.tsx import from here so node colors and
// badge colors are always in sync.
// ─────────────────────────────────────────────────────────────────────────────

export const PALETTE       = ["#378ADD","#1D9E75","#D85A30","#7F77DD","#BA7517","#D4537E","#639922","#E24B4A"];
export const PALETTE_LIGHT = ["#E6F1FB","#E1F5EE","#FAECE7","#EEEDFE","#FAEEDA","#FBEAF0","#EAF3DE","#FCEBEB"];
export const PALETTE_TEXT  = ["#042C53","#04342C","#4A1B0C","#26215C","#412402","#4B1528","#173404","#501313"];

// Me node always gets gold — never goes through the palette
export const ME_COLORS = { fill: "#F59E0B", light: "#FEF3C7", text: "#78350F" };

// Module-level map — shared across all imports in the same bundle,
// so Graph.tsx and ProfilePanel.tsx always assign the same color to the same tag.
const groupColorIdx: Record<string, number> = {};
let colorIdx = 0;

export function gc(group: string): { fill: string; light: string; text: string } {
  if (!group) group = "__ungrouped__";
  if (groupColorIdx[group] === undefined) {
    groupColorIdx[group] = colorIdx++ % PALETTE.length;
  }
  const i = groupColorIdx[group];
  return { fill: PALETTE[i], light: PALETTE_LIGHT[i], text: PALETTE_TEXT[i] };
}

// Convenience: returns colors for a person respecting the Me special case
export function personColors(primary_tag: string, name: string) {
  if (primary_tag?.toLowerCase() === "me") return ME_COLORS;
  return gc(primary_tag || name);
}
