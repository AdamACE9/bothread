import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Importance, ThreadEntry } from "@bothread/shared";
import { sendOverseer } from "../api";
import { Icon } from "../icons";
import { useToast } from "../toast";
import { Avatar } from "../ui";
import { ALL_WORDS, STATE_LABEL, modelLine, parseRecipients, removeMention, useMentionPicker, type Delivery, type MentionAgent } from "./mentions";

export interface ComposerHandle {
  focus: () => void;
  mention: (name: string) => void;
  /** @Name plus "Stop and read": the closest thing to tapping an agent on the shoulder. */
  ping: (name: string) => void;
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
    agents: MentionAgent[];
    channels: string[];
    replyTo: ThreadEntry | null;
    onClearReply: () => void;
    afterSend: () => void;
    /** Called with the sent message's seq and who it reached, so the thread can show delivery. */
    onSent?: (seq: number, deliveries: Delivery[]) => void;
  }
>(function Composer({ roomId, paused, agents, channels, replyTo, onClearReply, afterSend, onSent }, ref) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [importance, setImportance] = useState<Importance>("steering");
  const [channel, setChannel] = useState("");
  const [sending, setSending] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mp = useMentionPicker({ value: text, setValue: setText, fieldRef: ta, agents });

  const insertMention = (name: string) => {
    setText((t) => (new RegExp(`@${escapeRe(name)}(?![\\w-])`, "i").test(t) ? t : t.trim() ? `${t.replace(/\s*$/, " ")}@${name} ` : `@${name} `));
    requestAnimationFrame(() => {
      const el = ta.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    mention: insertMention,
    ping: (name) => {
      insertMention(name);
      setImportance("interrupt");
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

  const recipients = useMemo(() => parseRecipients(text, agents), [text, agents]);
  const byName = new Map(agents.map((a) => [a.name, a]));
  const activeAgents = agents.filter((a) => a.state !== "left");

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    const rec = parseRecipients(t, agents);
    const targets = rec.all ? activeAgents : agents.filter((a) => rec.names.includes(a.name));
    const mentions = Array.from(new Set([...(rec.all ? ["all"] : []), ...targets.map((a) => a.name)]));
    // Snapshot presence at send time: that is what decides whether they see it now.
    const deliveryTo = targets.length ? targets : importance === "interrupt" ? activeAgents : [];
    const deliveries: Delivery[] = deliveryTo.map((a) => ({ name: a.name, state: a.state }));
    setSending(true);
    setText("");
    mp.close();
    try {
      const res = await sendOverseer(roomId, {
        text: t,
        importance,
        mentions,
        threadId: channel || undefined,
        replyToSeq: replyTo?.seq,
      });
      const seq = res?.message?.seq;
      if (typeof seq === "number" && deliveries.length) onSent?.(seq, deliveries);
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
        {mp.picker}
        {text.trim() && agents.length > 0 && (
          <div className="recipients" aria-live="polite">
            <span className="rcp-to">To</span>
            {recipients.all && (
              <span className="rcp-chip all">
                <Icon name="users" size={12} />
                Everyone ({activeAgents.length})
                <button type="button" aria-label="Remove @all" onClick={() => setText(ALL_WORDS.reduce((t, w) => removeMention(t, w), text))}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            )}
            {recipients.names.map((n) => {
              const a = byName.get(n);
              return (
                <span key={n} className={`rcp-chip st-${a?.state ?? "working"}`} title={a ? `${STATE_LABEL[a.state]}${modelLine(a) ? `, ${modelLine(a)}` : ""}` : undefined}>
                  <Avatar name={n} brand={a?.brand} size={16} />
                  {n}
                  <span className="dot" aria-hidden="true" />
                  <button type="button" aria-label={`Remove ${n}`} onClick={() => setText(removeMention(text, n))}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              );
            })}
            {!recipients.all && recipients.names.length === 0 && (
              <span className="rcp-none">
                {importance === "interrupt" ? "Everyone active, as an interrupt." : "Everyone reads it on their next check. Type @ to ping someone."}
              </span>
            )}
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
                ? "Tell the agents what to do. Type @ to ping one."
                : "Write to the room. Agents read this when they join."
          }
          {...mp.fieldProps}
          onChange={(e) => {
            setText(e.target.value);
            mp.sync(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => mp.sync(text, (e.target as HTMLTextAreaElement).selectionStart)}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End")
              mp.sync(text, (e.target as HTMLTextAreaElement).selectionStart);
          }}
          onBlur={() => mp.close()}
          onKeyDown={(e) => {
            if (mp.onKeyDown(e)) return;
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
          {agents.length > 0 && (
            <button
              type="button"
              className={`at-btn${mp.open ? " on" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (mp.open ? mp.close() : mp.openAtCaret())}
              aria-label="Mention an agent"
              title="Mention an agent (@)"
            >
              @
            </button>
          )}
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
