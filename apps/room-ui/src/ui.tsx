import { useState, type ReactNode } from "react";
import type { ParticipantView } from "@bothread/shared";
import { copyText } from "./hooks";
import { Icon } from "./icons";

const KNOWN = ["claude", "cursor", "gemini", "codex", "opencode", "antigravity"];

export function brandKey(brand?: string | null): string {
  if (!brand) return "";
  const b = brand.toLowerCase();
  return KNOWN.find((k) => b.includes(k)) ?? "";
}
export function brandClass(brand?: string | null): string {
  const k = brandKey(brand);
  return k ? `b-${k}` : "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  brand,
  kind,
  size = 32,
  ring,
}: {
  name: string;
  brand?: string | null;
  kind?: ParticipantView["kind"];
  size?: number;
  /** Presence ring: live (listening), active, idle, off. */
  ring?: "live" | "active" | "idle" | "off";
}) {
  const cls = kind === "human" ? "human" : brandClass(brand);
  return (
    <span
      className={`av ${cls}${ring ? ` ring-${ring}` : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function presence(p: ParticipantView): "live" | "active" | "idle" | "off" {
  if (p.status === "left" || p.status === "revoked") return "off";
  if (p.kind === "agent" && p.listening) return "live";
  if (p.idle || p.status === "muted") return "idle";
  return "active";
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title?: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-icon">{icon}</span>}
      {title && <p className="empty-title">{title}</p>}
      {children && <p>{children}</p>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function CopyButton({ text, label = "Copy", done = "Copied", className = "btn sm" }: { text: string; label?: string; done?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className={`${className}${ok ? " copied" : ""}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        }
      }}
    >
      <Icon name={ok ? "check" : "copy"} size={13} />
      {ok ? done : label}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Message rendering: a small, safe markdown subset built as React nodes (never
 * innerHTML). Agents write fenced code, lists, **bold**, `code`, links and
 * @mentions constantly; showing them raw made the thread hard to scan.
 * ------------------------------------------------------------------------- */

/** Matches a relative `.bothread/attachments/<file>.<img-ext>` reference in message text. */
const ATTACHMENT_IMAGE_RE = /[^\s`]*\.bothread\/attachments\/([^\s`]+\.(?:png|jpe?g|gif|webp))/gi;

function attachmentBasename(matchedPath: string): string {
  const cleaned = matchedPath.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RichCtx {
  roomId?: string;
  names?: string[];
  me?: string;
}

/** Inline pass: `code`, **bold**, *em*, [label](url), bare URLs and @Name mentions. */
function inline(text: string, ctx: RichCtx, keyBase: string): ReactNode[] {
  const names = [...(ctx.names ?? [])].sort((a, b) => b.length - a.length);
  const mention = names.length ? `@(?:${names.map(escapeRe).join("|")})(?![\\w-])` : "@[A-Za-z][\\w-]*";
  const re = new RegExp(
    "(`[^`\\n]+`)|(\\*\\*[^*\\n]+\\*\\*)|(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^)\\s]+\\))|(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?'\"])|(" +
      mention +
      ")|((?<![\\w*])\\*[^*\\n]+\\*(?!\\w))",
    "gi"
  );
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const k = `${keyBase}-${i++}`;
    const [tok, code, bold, mdLink, url, at, em] = m;
    if (code) out.push(<code key={k}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={k}>{bold.slice(2, -2)}</strong>);
    else if (mdLink) {
      const mm = mdLink.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push(
        <a key={k} href={mm[2]} target="_blank" rel="noreferrer noopener">
          {mm[1]}
        </a>
      );
    } else if (url)
      out.push(
        <a key={k} href={url} target="_blank" rel="noreferrer noopener">
          {url}
        </a>
      );
    else if (at) {
      const isMe = ctx.me && at.slice(1).toLowerCase() === ctx.me.toLowerCase();
      out.push(
        <span key={k} className={`mention${isMe ? " me" : ""}`}>
          {at}
        </span>
      );
    } else if (em) out.push(<em key={k}>{em.slice(1, -1)}</em>);
    else out.push(tok);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{lang || "text"}</span>
        <CopyButton text={code} className="codeblock-copy" />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Block pass: fenced code, bullet/numbered lists, paragraphs. */
export function richText(text: string, roomId?: string, opts: { names?: string[]; me?: string } = {}): ReactNode[] {
  const ctx: RichCtx = { roomId, ...opts };
  const nodes: ReactNode[] = [];
  const images = new Set<string>();
  if (roomId) for (const m of text.matchAll(ATTACHMENT_IMAGE_RE)) images.add(attachmentBasename(m[1]!));

  const parts = text.split(/```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g);
  // split with 2 capture groups → [text, lang, code, text, lang, code, ...]
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i] ?? "";
    if (prose.trim()) {
      const lines = prose.replace(/^\n+|\n+$/g, "").split("\n");
      let list: { ordered: boolean; items: string[] } | null = null;
      let para: string[] = [];
      const flushPara = () => {
        if (!para.length) return;
        const k = `p${i}-${nodes.length}`;
        nodes.push(
          <p key={k}>
            {para.flatMap((l, j) => (j ? [<br key={`${k}br${j}`} />, ...inline(l, ctx, `${k}-${j}`)] : inline(l, ctx, `${k}-${j}`)))}
          </p>
        );
        para = [];
      };
      const flushList = () => {
        if (!list) return;
        const k = `l${i}-${nodes.length}`;
        const items = list.items.map((it, j) => <li key={`${k}-${j}`}>{inline(it, ctx, `${k}-${j}`)}</li>);
        nodes.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
        list = null;
      };
      for (const line of lines) {
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (bullet || num) {
          flushPara();
          const ordered = !!num;
          if (!list || list.ordered !== ordered) {
            flushList();
            list = { ordered, items: [] };
          }
          list.items.push((bullet ?? num)![1]!);
        } else if (!line.trim()) {
          flushList();
          flushPara();
        } else {
          flushList();
          para.push(line);
        }
      }
      flushList();
      flushPara();
    }
    if (i + 2 < parts.length) {
      const code = (parts[i + 2] ?? "").replace(/\n$/, "");
      if (code) nodes.push(<CodeBlock key={`c${i}`} code={code} lang={parts[i + 1] ?? ""} />);
    }
  }

  [...images].forEach((basename) => {
    nodes.push(
      <a
        key={`img-${basename}`}
        className="attachment"
        href={`/api/rooms/${roomId}/attachments/${encodeURIComponent(basename)}`}
        target="_blank"
        rel="noreferrer"
      >
        <img
          className="attachment-preview"
          src={`/api/rooms/${roomId}/attachments/${encodeURIComponent(basename)}`}
          alt={basename}
          loading="lazy"
        />
        <span>{basename}</span>
      </a>
    );
  });
  return nodes;
}
