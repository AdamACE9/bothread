import type { ParticipantView } from "@bothread/shared";

const KNOWN = ["claude", "cursor", "gemini", "codex"];

export function brandClass(brand?: string): string {
  if (!brand) return "";
  const b = brand.toLowerCase();
  const hit = KNOWN.find((k) => b.includes(k));
  return hit ? `b-${hit}` : "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function Avatar({ name, brand, kind }: { name: string; brand?: string; kind?: ParticipantView["kind"] }) {
  const cls = kind === "human" ? "human" : brandClass(brand);
  return (
    <span className={`av ${cls}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Render inline `code` spans from text wrapped in backticks. */
export function richText(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>
  );
}
