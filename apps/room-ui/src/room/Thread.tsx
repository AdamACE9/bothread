import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ThreadEntry } from "@bothread/shared";
import { OVERSEER_THREAD_LIMIT } from "@bothread/shared";
import { getMessagesBefore } from "../api";
import { copyText } from "../hooks";
import { Icon, type IconName } from "../icons";
import { Avatar, CopyButton, fmtDay, fmtTime, richText } from "../ui";

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

export function needsYou(m: ThreadEntry, overseer: string): boolean {
  if (m.kind !== "agent" || m.retractedAt) return false;
  if (m.importance === "interrupt") return true;
  const lower = m.mentions.map((x) => x.toLowerCase());
  return lower.includes(overseer.toLowerCase()) || lower.includes("human") || lower.includes("overseer");
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
  const prevHeight = useRef<number | null>(null);

  useEffect(() => {
    setOlder([]);
    setServerHasMore(null);
    setTopic("");
    setOnlyYou(false);
    lastSeq.current = 0;
  }, [roomId]);

  const latest = thread[thread.length - 1]?.seq ?? 0;

  // Stick to the bottom only when the reader is already there; otherwise count
  // what arrived so "jump to latest" can say how much they missed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastSeq.current === 0 || atBottom) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "j" && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector(".overlay")) jump();
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
    if (onlyYou) return needsYou(m, overseerName);
    if (topic) return m.threadId === topic || m.kind === "system";
    return true;
  });

  const goTo = (seq: number) => {
    const el = ref.current?.querySelector(`[data-seq="${seq}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(seq);
      setTimeout(() => setFlash(null), 1600);
    }
  };

  const onlySystem = combined.every((m) => m.kind === "system");

  const rows: ReactNode[] = [];
  let prev: ThreadEntry | undefined;
  for (const m of visible) {
    if (!prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()) {
      rows.push(
        <div className="day" key={`day-${m.seq}`}>
          <span>{fmtDay(m.at)}</span>
        </div>
      );
    }
    if (m.kind === "system") {
      const tone = m.importance === "interrupt" ? "alert" : m.importance === "steering" ? "steer" : "";
      rows.push(
        <div className={`sysline ${tone}${flash === m.seq ? " flash" : ""}`} key={m.seq} data-seq={m.seq} role={m.importance === "interrupt" ? "alert" : undefined}>
          <Icon name={systemIcon(m.text)} size={13} />
          <span className="sys-text">{richText(m.text, roomId, { names })}</span>
          <time>{fmtTime(m.at)}</time>
        </div>
      );
    } else {
      const grouped =
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
      ]
        .filter(Boolean)
        .join(" ");
      rows.push(
        <article className={cls} key={m.seq} data-seq={m.seq}>
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
                <span className="author">{m.author}</span>
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
            <div className="msg-text">{m.retractedAt ? <p>Message retracted by {m.author}.</p> : richText(m.text, roomId, { names, me: overseerName })}</div>
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
      {(topics.length > 0 || youCount > 0) && (
        <div className="thread-filters" role="toolbar" aria-label="Filter the thread">
          <button className={`chip${!topic && !onlyYou ? " on" : ""}`} onClick={() => (setTopic(""), setOnlyYou(false))}>
            Everything
          </button>
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
      )}
      <div className="thread" ref={ref} onScroll={onScroll} role="log" aria-live="polite" aria-label="Room conversation">
        {hasMore && (
          <button className="load-earlier" onClick={loadEarlier} disabled={loading}>
            {loading ? "Loading" : "Load earlier messages"}
          </button>
        )}
        {!hasAgents && onlySystem ? empty : rows}
        {(onlyYou || topic) && visible.length === 0 && <p className="muted-line center">Nothing here yet.</p>}
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
