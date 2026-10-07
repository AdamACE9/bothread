import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import type { ParticipantView } from "@bothread/shared";
import { Icon } from "../icons";
import { Avatar, presence } from "../ui";

/* ---------------------------------------------------------------------------
 * @mentions: the picker, recipient parsing, and delivery wording. Shared by the
 * composer and the approval "Redirect" input so both feel the same.
 * ------------------------------------------------------------------------- */

export type AgentState = "listening" | "working" | "idle" | "left";

export interface MentionAgent {
  id: string;
  name: string;
  brand?: string;
  model?: string;
  client?: string;
  state: AgentState;
}

const STATE_ORDER: Record<AgentState, number> = { listening: 0, working: 1, idle: 2, left: 3 };
export const STATE_LABEL: Record<AgentState, string> = { listening: "Listening", working: "Working", idle: "Idle", left: "Left" };

/** Words that address everyone active in the room. */
export const ALL_WORDS = ["all", "everyone", "here"];

export function agentState(p: ParticipantView): AgentState {
  if (p.status === "left" || p.status === "revoked") return "left";
  if (p.listening) return "listening";
  if (p.idle || p.status === "muted") return "idle";
  return "working";
}

/** "Claude Opus 5.5 in Claude Code", or just the model, or nothing when the agent never said. */
export function modelLine(p: { model?: string; client?: string }): string {
  const model = p.model?.trim();
  if (!model) return "";
  const client = p.client?.trim();
  return client ? `${model} in ${client}` : model;
}

export function toMentionAgent(p: ParticipantView): MentionAgent {
  return { id: p.id, name: p.name, brand: p.brand, model: p.model, client: p.client, state: agentState(p) };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Subsequence fuzzy match; lower is better, -1 is no match. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct === 0) return 0;
  if (direct > 0) return /\s/.test(t[direct - 1] ?? "") ? 1 : 2 + direct / 100;
  let ti = 0;
  let gaps = 0;
  for (const ch of q.replace(/\s+/g, "")) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return 10 + gaps;
}

/** Finds the "@query" the caret sits in: "@" at the start, or after whitespace or punctuation. */
export function mentionAt(value: string, caret: number): { query: string; start: number } | null {
  const before = value.slice(0, caret);
  const m = before.match(/(^|[\s([{,.;:!?"'])@([^\s@\n][^@\n]{0,29})?$/);
  if (!m) return null;
  const query = m[2] ?? "";
  return { query, start: caret - query.length - 1 };
}

export interface Recipients {
  all: boolean;
  names: string[];
}

/** Who the text pings: named agents plus whether it addresses everyone. */
export function parseRecipients(text: string, agents: { name: string }[]): Recipients {
  const names = agents.filter((a) => new RegExp(`(^|[^\\w])@${escapeRe(a.name)}(?![\\w-])`, "i").test(text)).map((a) => a.name);
  const all = new RegExp(`(^|[^\\w])@(${ALL_WORDS.join("|")})(?![\\w-])`, "i").test(text);
  return { all, names };
}

/** Removes every "@Name" token for this name (and its trailing space). */
export function removeMention(text: string, name: string): string {
  return text.replace(new RegExp(`(^|[^\\w])@${escapeRe(name)}(?![\\w-]) ?`, "gi"), "$1");
}

export type PickOption = { kind: "all"; key: string; count: number } | { kind: "agent"; key: string; agent: MentionAgent };

export function buildOptions(agents: MentionAgent[], query: string, withAll: boolean): PickOption[] {
  const active = agents.filter((a) => a.state !== "left");
  const scored = agents
    .map((a) => ({ a, s: Math.min(...[fuzzy(query, a.name), a.model ? fuzzy(query, a.model) + 0.5 : -1].filter((x) => x >= 0).concat([Infinity])) }))
    .filter((r) => r.s !== Infinity)
    .sort((x, y) => (query ? x.s - y.s : 0) || STATE_ORDER[x.a.state] - STATE_ORDER[y.a.state] || x.a.name.localeCompare(y.a.name));
  const opts: PickOption[] = scored.map((r) => ({ kind: "agent", key: r.a.id, agent: r.a }));
  const q = query.toLowerCase().trim();
  if (withAll && active.length > 1 && (!q || ALL_WORDS.some((w) => w.startsWith(q)) || "everyone active".includes(q)))
    opts.unshift({ kind: "all", key: "@all", count: active.length });
  return opts;
}

export function optionText(o: PickOption): string {
  return o.kind === "all" ? "all" : o.agent.name;
}

/* ----- The picker list ----- */

export function MentionPicker({
  id,
  options,
  active,
  query,
  onHover,
  onPick,
  placement = "above",
}: {
  id: string;
  options: PickOption[];
  active: number;
  query: string;
  onHover: (i: number) => void;
  onPick: (o: PickOption) => void;
  placement?: "above" | "below";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className={`mpick ${placement}`} onMouseDown={(e) => e.preventDefault()}>
      <div className="mpick-head">
        <span>{query ? `Agents matching "${query}"` : "Mention an agent"}</span>
        <span className="mpick-keys" aria-hidden="true">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> move <kbd className="kbd">Tab</kbd> pick <kbd className="kbd">Esc</kbd> close
        </span>
      </div>
      <div className="mpick-list" role="listbox" id={id} aria-label="Mention an agent" ref={listRef}>
        {options.length === 0 && (
          <div className="mpick-empty" role="status">
            <Icon name="search" size={14} />
            <span>
              No agent named <strong>{query}</strong>
            </span>
          </div>
        )}
        {options.map((o, i) => (
          <div
            key={o.key}
            id={`${id}-${i}`}
            data-i={i}
            role="option"
            aria-selected={i === active}
            className={`mpick-item${i === active ? " sel" : ""}${o.kind === "agent" ? ` st-${o.agent.state}` : " all"}`}
            onMouseMove={() => i !== active && onHover(i)}
            onClick={() => onPick(o)}
          >
            {o.kind === "all" ? (
              <>
                <span className="mpick-all-icon" aria-hidden="true">
                  <Icon name="users" size={15} />
                </span>
                <span className="mpick-main">
                  <span className="mpick-name">@all</span>
                  <span className="mpick-model">Everyone active ({o.count})</span>
                </span>
                <span className="mpick-state">Broadcast</span>
              </>
            ) : (
              <>
                <Avatar name={o.agent.name} brand={o.agent.brand} size={26} ring={stateRing(o.agent.state)} />
                <span className="mpick-main">
                  <span className="mpick-name">{o.agent.name}</span>
                  {modelLine(o.agent) && <span className="mpick-model">{modelLine(o.agent)}</span>}
                </span>
                <span className={`mpick-state ${o.agent.state}`}>
                  <span className="dot" aria-hidden="true" />
                  {STATE_LABEL[o.agent.state]}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function stateRing(s: AgentState): ReturnType<typeof presence> {
  return s === "listening" ? "live" : s === "working" ? "active" : s === "idle" ? "idle" : "off";
}

/* ----- Hook wiring a text input or textarea to the picker ----- */

type Field = HTMLTextAreaElement | HTMLInputElement;

export function useMentionPicker({
  value,
  setValue,
  fieldRef,
  agents,
  withAll = true,
  placement = "above",
}: {
  value: string;
  setValue: (v: string) => void;
  fieldRef: RefObject<Field | null>;
  agents: MentionAgent[];
  withAll?: boolean;
  placement?: "above" | "below";
}) {
  const id = `mp${useId().replace(/[^\w]/g, "")}`;
  const [at, setAt] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  // The "@" position the user closed (Esc) or already completed, so it doesn't pop back open.
  const dismissed = useRef<number | null>(null);

  const options = useMemo(() => (at ? buildOptions(agents, at.query, withAll) : []), [at, agents, withAll]);
  // A query with a space that matches nothing means the user moved on to normal prose.
  const open = !!at && agents.length > 0 && (options.length > 0 || !/\s/.test(at.query));

  const sync = (v: string, caret: number | null) => {
    const found = caret === null ? null : mentionAt(v, caret);
    if (!found) {
      dismissed.current = null;
      setAt(null);
      return;
    }
    if (dismissed.current === found.start) {
      setAt(null);
      return;
    }
    dismissed.current = null;
    setAt((prev) => {
      if (!prev || prev.query !== found.query) setActive(0);
      return found;
    });
  };

  const pick = (o: PickOption) => {
    const el = fieldRef.current;
    if (!at || !el) return;
    const caret = el.selectionStart ?? value.length;
    const name = optionText(o);
    const rest = value.slice(caret).replace(/^[^\s]*/, "");
    const next = `${value.slice(0, at.start)}@${name} ${rest.replace(/^\s+/, "")}`;
    const pos = at.start + name.length + 2;
    dismissed.current = at.start;
    setValue(next);
    setAt(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  /** Opens the picker at the caret by typing an "@" (used by the @ button). */
  const openAtCaret = () => {
    const el = fieldRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const pad = before && !/[\s([{]$/.test(before) ? " " : "";
    const next = `${before}${pad}@${value.slice(caret)}`;
    const pos = caret + pad.length + 1;
    dismissed.current = null;
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      sync(next, pos);
    });
  };

  /** Returns true when the key was handled by the picker. */
  const onKeyDown = (e: ReactKeyboardEvent<Field>): boolean => {
    if (!open || !at) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return true;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + d + options.length) % options.length);
      return true;
    }
    if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && options.length) {
      e.preventDefault();
      pick(options[Math.min(active, options.length - 1)]!);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismissed.current = at.start;
      setAt(null);
      return true;
    }
    return false;
  };

  const picker: ReactNode = open ? (
    <MentionPicker
      id={id}
      options={options}
      active={Math.min(active, Math.max(0, options.length - 1))}
      query={at!.query}
      onHover={setActive}
      onPick={pick}
      placement={placement}
    />
  ) : null;

  const fieldProps = {
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    "aria-activedescendant": open && options.length ? `${id}-${Math.min(active, options.length - 1)}` : undefined,
  };

  return {
    open,
    picker,
    onKeyDown,
    sync,
    openAtCaret,
    fieldProps,
    close: () => setAt(null),
  };
}

/* ----- Delivery: who sees a message now vs on their next step ----- */

export interface Delivery {
  name: string;
  state: AgentState;
}

export function deliveryLines(list: Delivery[]): { tone: "now" | "queued" | "away"; text: string }[] {
  const join = (names: string[]) =>
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const by = (s: AgentState[]) => list.filter((d) => s.includes(d.state)).map((d) => d.name);
  const out: { tone: "now" | "queued" | "away"; text: string }[] = [];
  const now = by(["listening"]);
  const busy = by(["working"]);
  const idle = by(["idle"]);
  const left = by(["left"]);
  if (now.length) out.push({ tone: "now", text: `Delivered to ${join(now)} (listening, will see it now)` });
  if (busy.length) out.push({ tone: "queued", text: `Queued for ${join(busy)} (busy, will see it on ${busy.length > 1 ? "their" : "its"} next step)` });
  if (idle.length) out.push({ tone: "queued", text: `Queued for ${join(idle)} (idle, will see it when ${idle.length > 1 ? "they check" : "it checks"} in)` });
  if (left.length) out.push({ tone: "away", text: `Waiting for ${join(left)} (left the room, will see it on rejoining)` });
  return out;
}
