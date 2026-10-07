import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Approval, RoomTask, ThreadEntry } from "@bothread/shared";
import { OVERSEER_THREAD_LIMIT } from "@bothread/shared";
import { getMessagesBefore } from "../api";
import { copyText, modKey } from "../hooks";
import { Icon, type IconName } from "../icons";
import { Avatar, CopyButton, fmtDay, fmtTime, richText } from "../ui";
import { brandColor } from "../charts";
import { EventCard, parseSystem, softenDashes, type ParsedEvent } from "./EventCard";
import { deliveryLines, type Delivery } from "./mentions";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Picks an icon for a system line from its wording (they're plain text from the engine). */
function systemIcon(text: string): IconName {
  const t = text.toLowerCase();
  if (t.startsWith("prevented")) return "shield";
  if (t.includes("joined") || t.includes("left the room") || t.includes("revoked")) return "users";
  if (t.includes("approval") || t.includes("approved") || t.includes("rejected")) return "hand";
  if (t.includes("task")) return "tasks";
  if (t.includes("recorded") || t.includes("resolved")) return "note";
  if (t.includes("paused") || t.includes("resumed")) return "pause";
  if (t.includes("merged") || t.includes("discard") || t.includes("changes")) return "diff";
  if (t.includes("wants") || t.includes("needs") || t.includes("release")) return "lock";
  return "sparkle";
}

const HUMAN_WORDS = ["you", "human", "overseer"];

/** True when an agent message @mentions the human (by name, "You", "human" or "overseer"). */
export function mentionsHuman(m: { mentions: string[]; text: string }, overseer: string): boolean {
  const words = Array.from(new Set([overseer.toLowerCase(), ...HUMAN_WORDS]));
  if (m.mentions.some((x) => words.includes(x.toLowerCase()))) return true;
  return words.some((w) => new RegExp(`(^|[^\\w])@${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(m.text));
}

export function needsYou(m: ThreadEntry, overseer: string): boolean {
  if (m.kind !== "agent" || m.retractedAt) return false;
  if (m.importance === "interrupt") return true;
  return mentionsHuman(m, overseer);
}

/** Messages by an agent, or that mention it. */
function involves(m: ThreadEntry, name: string): boolean {
  const n = name.toLowerCase();
  if (m.author.toLowerCase() === n) return true;
  if (m.mentions.some((x) => x.toLowerCase() === n)) return true;
  return m.text.toLowerCase().includes(`@${n}`);
}

const SEEN_KEY = (roomId: string) => `bothread.seen.${roomId}`;
function readSeen(roomId: string): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY(roomId));
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}
function writeSeen(roomId: string, seq: number) {
  try {
    localStorage.setItem(SEEN_KEY(roomId), String(seq));
  } catch {
    /* not persisted */
  }
}

export default function Thread({
  roomId,
  thread,
  brandByName,
  names,
  overseerName,
  channels,
  hasAgents,
  empty,
  onReply,
  modelByName,
  deliveries,
  focusAgent,
  onClearFocus,
  tasks = [],
  approvals = [],
  toolbarStart,
  active = true,
}: {
  roomId: string;
  thread: ThreadEntry[];
  brandByName: Map<string, string | undefined>;
  names: string[];
  overseerName: string;
  channels: string[];
  hasAgents: boolean;
  empty: ReactNode;
  onReply: (m: ThreadEntry) => void;
  /** "Claude Opus 5.5 in Claude Code" per author, when the agent said. */
  modelByName?: Map<string, string>;
  /** Who each of the human's messages reached, keyed by seq. */
  deliveries?: Map<number, Delivery[]>;
  focusAgent?: string | null;
  onClearFocus?: () => void;
  /** For the visual event cards: task titles and what is still waiting on you. */
  tasks?: RoomTask[];
  approvals?: Approval[];
  /** Rendered at the start of the filter bar (the view switcher). */
  toolbarStart?: ReactNode;
  /** False while another stage view is showing: the thread stays mounted but idle. */
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [older, setOlder] = useState<ThreadEntry[]>([]);
  const [serverHasMore, setServerHasMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState("");
  const [onlyYou, setOnlyYou] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);
  const lastSeq = useRef<number>(0);
  // Only messages that arrive while the room is open animate in; the list on load does not.
  const enterFloor = useRef<number | null>(null);
  const entering = useRef<Set<number>>(new Set());
  const prevHeight = useRef<number | null>(null);
  const latest = thread[thread.length - 1]?.seq ?? 0;

  // Unread divider: the last seq this browser saw in this room, captured on open
  // and again whenever the reader comes back to the tab.
  const [divider, setDivider] = useState<number | null>(() => {
    const seen = readSeen(roomId);
    return seen !== null && seen < latest ? seen : null;
  });
  const hiddenAt = useRef<number | null>(null);
  const latestRef = useRef(latest);
  latestRef.current = latest;

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIdx, setHitIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOlder([]);
    setServerHasMore(null);
    setTopic("");
    setOnlyYou(false);
    setSearchOpen(false);
    setQuery("");
    lastSeq.current = 0;
    enterFloor.current = null;
    entering.current = new Set();
    const seen = readSeen(roomId);
    setDivider(seen !== null && seen < latestRef.current ? seen : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Remember what has been seen while the tab is in front.
  useEffect(() => {
    if (!latest) return;
    if (!document.hidden) writeSeen(roomId, latest);
  }, [roomId, latest]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        hiddenAt.current = latestRef.current;
        writeSeen(roomId, latestRef.current);
      } else {
        const was = hiddenAt.current;
        hiddenAt.current = null;
        if (was !== null && latestRef.current > was) setDivider((d) => (d !== null && d < was ? d : was));
        writeSeen(roomId, latestRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [roomId]);

  const markRead = () => {
    setDivider(null);
    writeSeen(roomId, latestRef.current);
  };

  // Stick to the bottom only when the reader is already there; otherwise count
  // what arrived so "jump to latest" can say how much they missed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = lastSeq.current === 0;
    if (first && divider !== null && el.querySelector(".unread-divider")) {
      el.querySelector(".unread-divider")!.scrollIntoView({ block: "start" });
      el.scrollTop -= 40;
    } else if (first || atBottom) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else if (latest > lastSeq.current) {
      setUnseen((u) => u + thread.filter((m) => m.seq > lastSeq.current).length);
    }
    lastSeq.current = latest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  // Keep the reading position steady when older messages are prepended.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    }
  }, [older]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  const jump = () => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  };

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const activeRef = useRef(active);
  activeRef.current = active;
  // Coming back from another view: land on the latest if that's where the reader was.
  useLayoutEffect(() => {
    const el = ref.current;
    if (active && el && atBottom) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const t = e.target as HTMLElement;
      if (e.key === "j" && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector(".overlay")) jump();
      // Ctrl/Cmd+F searches the thread. A second press inside the search box falls
      // through to the browser's own find, and dialogs keep the browser's too.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        if (document.querySelector(".overlay")) return;
        if (t === searchRef.current) return;
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasMore = serverHasMore ?? thread.length >= OVERSEER_THREAD_LIMIT;
  const combined = useMemo(() => {
    const seen = new Set(thread.map((m) => m.seq));
    return [...older.filter((m) => !seen.has(m.seq)), ...thread];
  }, [older, thread]);
  const oldestSeq = combined[0]?.seq;

  const loadEarlier = async () => {
    if (oldestSeq === undefined || loading) return;
    setLoading(true);
    try {
      const { messages, hasMore: more } = await getMessagesBefore(roomId, oldestSeq, 60);
      prevHeight.current = ref.current?.scrollHeight ?? null;
      setOlder((o) => [...messages, ...o]);
      setServerHasMore(more);
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  };

  const topics = Array.from(new Set([...channels, ...combined.map((m) => m.threadId).filter((t): t is string => !!t)])).sort();
  const bySeq = new Map(combined.map((m) => [m.seq, m]));
  const youCount = combined.filter((m) => needsYou(m, overseerName)).length;
  const visible = combined.filter((m) => {
    if (focusAgent && !involves(m, focusAgent)) return false;
    if (onlyYou) return needsYou(m, overseerName);
    if (topic) return m.threadId === topic || m.kind === "system";
    return true;
  });

  const q = searchOpen ? query.trim().toLowerCase() : "";
  const hits = q ? visible.filter((m) => !m.retractedAt && (m.text.toLowerCase().includes(q) || m.author.toLowerCase().includes(q))).map((m) => m.seq) : [];
  const curHit = hits.length ? hits[Math.min(hitIdx, hits.length - 1)] : undefined;
  const hitSet = new Set(hits);

  useEffect(() => {
    // New query: start from the newest match, like reading up from the bottom.
    setHitIdx(Math.max(0, hits.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (curHit === undefined) return;
    ref.current?.querySelector(`[data-seq="${curHit}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [curHit]);

  const stepHit = (d: number) => hits.length && setHitIdx((i) => (Math.min(i, hits.length - 1) + d + hits.length) % hits.length);

  // The divider sits above the first message from someone else after the last-seen seq.
  const dividerAt = divider !== null ? visible.find((m) => m.seq > divider && m.kind !== "human")?.seq : undefined;
  const newCount = divider !== null ? combined.filter((m) => m.seq > divider && m.kind !== "human" && m.kind !== "system").length : 0;

  const goTo = (seq: number) => {
    const el = ref.current?.querySelector(`[data-seq="${seq}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(seq);
      setTimeout(() => setFlash(null), 1600);
    }
  };

  const onlySystem = combined.every((m) => m.kind === "system");

  // New-arrival animation: everything at or below the floor seen on first paint is static.
  if (enterFloor.current === null && latest) enterFloor.current = latest;
  const floor = enterFloor.current ?? Infinity;
  for (const m of thread) if (m.seq > floor) entering.current.add(m.seq);

  // Parse system lines once per render; pair approval requests with their later decision.
  const parsed = new Map<number, ParsedEvent | null>();
  for (const m of combined) if (m.kind === "system") parsed.set(m.seq, parseSystem(m.text));
  const decisionOf = new Map<number, "approved" | "rejected" | "edited">();
  {
    const open: { seq: number; key: string }[] = [];
    for (const m of combined) {
      const ev = parsed.get(m.seq);
      if (ev?.kind !== "approval") continue;
      const key = `${ev.who}|${ev.action}`;
      if (!ev.decision) open.push({ seq: m.seq, key });
      else {
        const i = open.findIndex((o) => o.key === key);
        if (i !== -1) decisionOf.set(open.splice(i, 1)[0]!.seq, ev.decision);
      }
    }
  }

  const rows: ReactNode[] = [];
  let prev: ThreadEntry | undefined;
  for (const m of visible) {
    if (m.seq === dividerAt) {
      rows.push(
        <div className="unread-divider" key={`unread-${m.seq}`} role="separator" aria-label="New since you left">
          <span className="ud-label">New since you left{newCount > 0 ? ` (${newCount})` : ""}</span>
          <button className="chip ud-mark" onClick={markRead}>
            <Icon name="check" size={12} /> Mark read
          </button>
        </div>
      );
    }
    if (!prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()) {
      rows.push(
        <div className="day" key={`day-${m.seq}`}>
          <span>{fmtDay(m.at)}</span>
        </div>
      );
    }
    const enter = entering.current.has(m.seq) ? " enter" : "";
    const marks = `${flash === m.seq ? " flash" : ""}${hitSet.has(m.seq) ? " hit" : ""}${curHit === m.seq ? " hit-cur" : ""}${enter}`;
    const ev = m.kind === "system" ? parsed.get(m.seq) : null;
    if (m.kind === "system" && ev && ev.kind !== "presence") {
      rows.push(
        <EventCard
          key={m.seq}
          ev={ev}
          m={m}
          brandByName={brandByName}
          tasks={tasks}
          approvals={approvals}
          decisionFor={decisionOf.get(m.seq)}
          className={marks}
        />
      );
    } else if (m.kind === "system" && ev?.kind === "presence") {
      rows.push(
        <div className={`sysline presence-line ${ev.verb}${marks}`} key={m.seq} data-seq={m.seq} style={{ ["--accent" as string]: brandColor(brandByName.get(ev.who)) }}>
          <Avatar name={ev.who} brand={brandByName.get(ev.who)} size={18} />
          <span className="sys-text">
            <strong>{q ? highlightAuthor(ev.who, q) : ev.who}</strong> {ev.verb === "joined" ? "joined the room" : "left the room"}
          </span>
          <time>{fmtTime(m.at)}</time>
        </div>
      );
    } else if (m.kind === "system") {
      const tone = m.importance === "interrupt" ? "alert" : m.importance === "steering" ? "steer" : "";
      rows.push(
        <div className={`sysline ${tone}${marks}`} key={m.seq} data-seq={m.seq} role={m.importance === "interrupt" ? "alert" : undefined}>
          <Icon name={systemIcon(m.text)} size={13} />
          <span className="sys-text">{richText(softenDashes(m.text), roomId, { names, highlight: q || undefined })}</span>
          <time>{fmtTime(m.at)}</time>
        </div>
      );
    } else {
      const grouped =
        m.seq !== dividerAt &&
        !!prev &&
        prev.kind === m.kind &&
        prev.author === m.author &&
        m.at - prev.at < GROUP_WINDOW_MS &&
        m.replyToSeq === undefined &&
        m.importance !== "interrupt" &&
        (prev.threadId ?? "") === (m.threadId ?? "");
      const replyTo = m.replyToSeq !== undefined ? bySeq.get(m.replyToSeq) : undefined;
      const forYou = needsYou(m, overseerName);
      const cls = [
        "msg",
        m.kind,
        grouped ? "grouped" : "",
        m.importance === "interrupt" ? "urgent" : m.importance === "steering" ? "steer" : m.importance === "advisory" ? "advisory" : "",
        forYou ? "for-you" : "",
        m.retractedAt ? "retracted" : "",
        flash === m.seq ? "flash" : "",
        hitSet.has(m.seq) ? "hit" : "",
        curHit === m.seq ? "hit-cur" : "",
        enter.trim(),
      ]
        .filter(Boolean)
        .join(" ");
      const accent = m.kind === "human" ? "var(--copper)" : brandColor(brandByName.get(m.author));
      rows.push(
        <article className={cls} key={m.seq} data-seq={m.seq} style={{ ["--accent" as string]: accent }}>
          <div className="msg-gutter">
            {grouped ? (
              <time className="msg-time-hover">{fmtTime(m.at)}</time>
            ) : (
              <Avatar name={m.author} brand={brandByName.get(m.author)} kind={m.kind === "human" ? "human" : "agent"} size={34} />
            )}
          </div>
          <div className="msg-body">
            {!grouped && (
              <header className="msg-head">
                <span className="author-dot" aria-hidden="true" />
                <span className="author" title={modelByName?.get(m.author) || undefined}>
                  {q ? highlightAuthor(m.author, q) : m.author}
                </span>
                {modelByName?.get(m.author) && <span className="author-model">{modelByName.get(m.author)}</span>}
                {m.threadId && (
                  <button className="topic-tag" onClick={() => setTopic(m.threadId!)} title={`Show only #${m.threadId}`}>
                    #{m.threadId}
                  </button>
                )}
                {m.importance === "interrupt" && <span className="imp-tag urgent">Needs a decision</span>}
                {m.importance === "steering" && m.kind === "agent" && <span className="imp-tag steer">Asks for action</span>}
                <time title={new Date(m.at).toLocaleString()}>{fmtTime(m.at)}</time>
                {m.editedAt && <span className="edited">edited</span>}
              </header>
            )}
            {m.replyToSeq !== undefined && (
              <button className="reply-quote" onClick={() => goTo(m.replyToSeq!)}>
                <Icon name="reply" size={12} />
                {replyTo ? (
                  <>
                    <strong>{replyTo.author}</strong> {replyTo.text.slice(0, 110)}
                    {replyTo.text.length > 110 ? "…" : ""}
                  </>
                ) : (
                  <>message #{m.replyToSeq}</>
                )}
              </button>
            )}
            <div className="msg-text">{m.retractedAt ? <p>Message retracted by {m.author}.</p> : richText(m.text, roomId, { names, me: overseerName, highlight: q || undefined })}</div>
            {m.kind === "human" && deliveries?.get(m.seq) && (
              <div className="delivery">
                {deliveryLines(deliveries.get(m.seq)!).map((l) => (
                  <span key={l.text} className={`dl ${l.tone}`}>
                    <Icon name={l.tone === "now" ? "zap" : l.tone === "queued" ? "clock" : "users"} size={12} />
                    {l.text}
                  </span>
                ))}
              </div>
            )}
          </div>
          {!m.retractedAt && (
            <div className="msg-actions">
              <button className="icon-btn sm" onClick={() => onReply(m)} title="Reply" aria-label="Reply">
                <Icon name="reply" size={14} />
              </button>
              <button className="icon-btn sm" onClick={() => copyText(m.text)} title="Copy text" aria-label="Copy text">
                <Icon name="copy" size={14} />
              </button>
            </div>
          )}
        </article>
      );
    }
    prev = m;
  }

  return (
    <div className="thread-col">
      <div className="thread-filters" role="toolbar" aria-label="Filter the thread">
        {toolbarStart}
        <div className="tf-chips">
          <button className={`chip${!topic && !onlyYou && !focusAgent ? " on" : ""}`} onClick={() => (setTopic(""), setOnlyYou(false), onClearFocus?.())}>
            Everything
          </button>
          {focusAgent && (
            <span className="chip on focus-chip">
              Showing {focusAgent}
              <button aria-label={`Stop showing only ${focusAgent}`} onClick={() => onClearFocus?.()}>
                <Icon name="x" size={11} />
              </button>
            </span>
          )}
          {youCount > 0 && (
            <button className={`chip you${onlyYou ? " on" : ""}`} onClick={() => (setOnlyYou((v) => !v), setTopic(""))}>
              <Icon name="hand" size={12} /> For you <span className="n">{youCount}</span>
            </button>
          )}
          {topics.map((t) => (
            <button key={t} className={`chip${topic === t ? " on" : ""}`} onClick={() => (setTopic(topic === t ? "" : t), setOnlyYou(false))}>
              #{t}
            </button>
          ))}
        </div>
        {searchOpen ? (
          <div className="tsearch" role="search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the thread"
              aria-label="Search the thread"
              aria-describedby="tsearch-count"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeSearch();
                } else if (e.key === "Enter" || e.key === "ArrowDown") {
                  e.preventDefault();
                  stepHit(e.shiftKey || e.key === "Enter" ? (e.shiftKey ? 1 : -1) : 1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  stepHit(-1);
                }
              }}
            />
            <span className="tsearch-count" id="tsearch-count" aria-live="polite">
              {q ? (hits.length ? `${Math.min(hitIdx, hits.length - 1) + 1} of ${hits.length}` : "No matches") : ""}
            </span>
            <button className="icon-btn sm" onClick={() => stepHit(-1)} disabled={!hits.length} aria-label="Previous match" title="Previous match (Up)">
              <Icon name="chevron" size={14} style={{ transform: "rotate(180deg)" }} />
            </button>
            <button className="icon-btn sm" onClick={() => stepHit(1)} disabled={!hits.length} aria-label="Next match" title="Next match (Down)">
              <Icon name="chevron" size={14} />
            </button>
            <button className="icon-btn sm" onClick={closeSearch} aria-label="Close search" title="Close (Esc)">
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : (
          <button className="icon-btn sm tsearch-open" onClick={openSearch} aria-label="Search the thread" title={`Search the thread (${modKey}+F)`}>
            <Icon name="search" size={15} />
          </button>
        )}
      </div>
      <div className="thread" ref={ref} onScroll={onScroll} role="log" aria-live="polite" aria-label="Room conversation">
        {hasMore && (
          <button className="load-earlier" onClick={loadEarlier} disabled={loading}>
            {loading ? "Loading" : "Load earlier messages"}
          </button>
        )}
        {!hasAgents && onlySystem ? empty : rows}
        {(onlyYou || topic || focusAgent) && visible.length === 0 && (
          <p className="muted-line center">{focusAgent ? `Nothing by or about ${focusAgent} yet.` : "Nothing here yet."}</p>
        )}
      </div>
      {!atBottom && (
        <button className="jump" onClick={jump}>
          <Icon name="arrowDown" size={14} />
          {unseen > 0 ? `${unseen} new message${unseen === 1 ? "" : "s"}` : "Latest"}
        </button>
      )}
    </div>
  );
}

function highlightAuthor(author: string, q: string): ReactNode {
  const i = author.toLowerCase().indexOf(q);
  if (i === -1) return author;
  return (
    <>
      {author.slice(0, i)}
      <mark className="hl">{author.slice(i, i + q.length)}</mark>
      {author.slice(i + q.length)}
    </>
  );
}

export function WaitingForAgents({ sessionId, onConnect }: { sessionId: string; onConnect: () => void }) {
  return (
    <div className="waiting">
      <div className="waiting-loom" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2>The room is ready. Bring in your agents.</h2>
      <p>
        Each agent needs the Bothread MCP server once, then this room's session ID. The connect panel writes both
        prompts for you, per agent.
      </p>
      <div className="waiting-actions">
        <button className="btn primary lg" onClick={onConnect}>
          <Icon name="plus" size={16} /> Connect an agent
        </button>
        <CopyButton text={`This is a Bothread session: ${sessionId}`} label="Copy join line" className="btn lg" />
      </div>
      <p className="waiting-foot">They show up on the left the moment they join.</p>
    </div>
  );
}
