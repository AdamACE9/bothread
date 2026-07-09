import type { ReactNode } from "react";
import type { ParticipantView } from "@bothread/shared";

const KNOWN = ["claude", "cursor", "gemini", "codex", "opencode"];

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

/** Matches a relative `.bothread/attachments/<file>.<img-ext>` reference in message text. */
const ATTACHMENT_IMAGE_RE = /[^\s]*\.bothread\/attachments\/([^\s]+\.(?:png|jpe?g|gif|webp))/gi;

/** Extract just the basename (no directories) from a matched attachment path. */
function attachmentBasename(matchedPath: string): string {
  const cleaned = matchedPath.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

/**
 * Render inline `code` spans (backtick-wrapped text) and, when `roomId` is
 * given, inline <img> previews for any `.bothread/attachments/*.png|jpg|...`
 * reference found in the text — so screenshots agents drop in the shared
 * attachments folder actually render in the room, not just as a path string.
 */
export function richText(text: string, roomId?: string) {
  const codeParts = text.split(/(`[^`]+`)/g);
  const nodes: ReactNode[] = [];
  const images: string[] = [];

  codeParts.forEach((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(<code key={`c${i}`}>{part.slice(1, -1)}</code>);
      return;
    }
    if (!roomId) {
      nodes.push(<span key={`s${i}`}>{part}</span>);
      return;
    }
    // Keep the surrounding prose intact; separately collect each attachment
    // image reference found in this segment for an inline preview below it.
    nodes.push(<span key={`s${i}`}>{part}</span>);
    for (const match of part.matchAll(ATTACHMENT_IMAGE_RE)) {
      images.push(attachmentBasename(match[1]!));
    }
  });

  images.forEach((basename, i) => {
    nodes.push(
      <img
        key={`img-${i}-${basename}`}
        className="attachment-preview"
        src={`/api/rooms/${roomId}/attachments/${encodeURIComponent(basename)}`}
        alt={basename}
        loading="lazy"
      />
    );
  });

  return nodes;
}
