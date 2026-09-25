import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Importance, ThreadEntry } from "@bothread/shared";
import { sendOverseer } from "../api";
import { Icon } from "../icons";
import { useToast } from "../toast";
import { Avatar } from "../ui";

export interface ComposerHandle {
  focus: () => void;
  mention: (name: string) => void;
}

const LEVELS: { value: Importance; label: string; title: string }[] = [
  { value: "info", label: "FYI", title: "Context only. Agents read it when they next check in." },
  { value: "steering", label: "Steer", title: "An instruction. Agents should act on it." },
  { value: "interrupt", label: "Stop and read", title: "Agents should stop and deal with this first." },
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const Composer = forwardRef<
  ComposerHandle,
  {
    roomId: string;
    paused: boolean;
    agents: { name: string; brand?: string }[];
    channels: string[];
    replyTo: ThreadEntry | null;
    onClearReply: () => void;
    afterSend: () => void;
  }
>(function Composer({ roomId, paused, agents, channels, replyTo, onClearReply, afterSend }, ref) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [importance, setImportance] = useState<Importance>("steering");
  const [channel, setChannel] = useState("");
  const [sending, setSending] = useState(false);
  const [suggest, setSuggest] = useState<{ query: string; start: number; index: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    mention: (name) => {
      setText((t) => (t.trim() ? `${t.replace(/\s*$/, " ")}@${name} ` : `@${name} `));
      requestAnimationFrame(() => {
        const el = ta.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    },
  }));

  useEffect(() => {
    if (replyTo) ta.current?.focus();
    if (replyTo?.threadId) setChannel(replyTo.threadId);
  }, [replyTo]);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const matches = suggest
    ? agents.filter((a) => a.name.toLowerCase().includes(suggest.query.toLowerCase())).slice(0, 6)
    : [];

  const updateSuggest = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\w .-]{0,24})$/);
    if (m && agents.length) {
      const query = m[1]!;
      // Stop suggesting once the typed text can't be the start of any name.
      if (!agents.some((a) => a.name.toLowerCase().startsWith(query.toLowerCase()) || a.name.toLowerCase().includes(query.toLowerCase()))) {
        setSuggest(null);
        return;
      }
      setSuggest({ query, start: caret - query.length - 1, index: 0 });
    } else setSuggest(null);
  };

  const pick = (name: string) => {
    if (!suggest) return;
    const el = ta.current!;
    const caret = el.selectionStart;
    const next = `${text.slice(0, suggest.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    setSuggest(null);
    requestAnimationFrame(() => {
      const pos = suggest.start + name.length + 2;
      el.focus();
      el.selectionStart = el.selectionEnd = pos;
    });
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    const mentions = agents
      .filter((a) => new RegExp(`@${escapeRe(a.name)}(?![\\w-])`, "i").test(t))
      .map((a) => a.name);
    setSending(true);
    setText("");
    try {
      await sendOverseer(roomId, {
        text: t,
        importance,
        mentions,
        threadId: channel || undefined,
        replyToSeq: replyTo?.seq,
      });
      onClearReply();
      if (importance === "interrupt") setImportance("steering");
      afterSend();
    } catch (err) {
      setText(t);
      toast.error(err, "Message not sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`composer${paused ? " paused" : ""}`}>
      {replyTo && (
        <div className="reply-chip">
          <Icon name="reply" size={13} />
          Replying to <strong>{replyTo.author}</strong>
          <span className="reply-snippet">{replyTo.text.slice(0, 90)}</span>
          <button className="icon-btn sm" onClick={onClearReply} aria-label="Cancel reply">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      <div className="composer-box">
        {suggest && matches.length > 0 && (
          <div className="mention-pop" role="listbox" aria-label="Mention an agent">
            {matches.map((a, i) => (
              <button
                key={a.name}
                role="option"
                aria-selected={i === suggest.index}
                className={i === suggest.index ? "sel" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a.name);
                }}
              >
                <Avatar name={a.name} brand={a.brand} size={20} />
                {a.name}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          aria-label="Message the room"
          placeholder={
            paused
              ? "Room is paused. Agents can still read what you write here."
              : agents.length
                ? "Tell the agents what to do. Type @ to address one."
                : "Write to the room. Agents read this when they join."
          }
          onChange={(e) => {
            setText(e.target.value);
            updateSuggest(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => updateSuggest(text, (e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={(e) => {
            if (suggest && matches.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setSuggest({ ...suggest, index: (suggest.index + d + matches.length) % matches.length });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(matches[suggest.index]!.name);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSuggest(null);
                return;
              }
            }
            if (e.key === "Escape" && replyTo) {
              onClearReply();
              return;
            }
            if (e.key === "Escape") {
              ta.current?.blur();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-bar">
          <div className="levels" role="radiogroup" aria-label="How urgent is this?">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                role="radio"
                aria-checked={importance === l.value}
                className={`level ${l.value}${importance === l.value ? " on" : ""}`}
                title={l.title}
                onClick={() => setImportance(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
          {channels.length > 0 && (
            <label className="channel-pick" title="Tag this message with a channel">
              <span>#</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
                <option value="">no channel</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="spacer" />
          <span className="composer-hint">
            <kbd className="kbd">Enter</kbd> send <kbd className="kbd">Shift</kbd>+<kbd className="kbd">Enter</kbd> new line
          </span>
          <button className="btn primary send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
            <Icon name="send" size={14} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
});

export default Composer;
