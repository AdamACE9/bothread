import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bucketize } from "./charts";
import type { AgentBranch, Approval, AuditEvent, ServerEvent, ThreadEntry } from "@bothread/shared";
import { chime, desktopNotify, flashTitle, setBaseTitle } from "./alerts";
import { getAudit, listBranches, setRoomStatus } from "./api";
import ConnectPanel from "./ConnectPanel";
import { useMedia, usePref, useNow } from "./hooks";
import { Icon, type IconName } from "./icons";
import { useHotkeys, usePaletteActions } from "./palette";
import { useToast } from "./toast";
import { Empty } from "./ui";
import { useRoom } from "./useRoom";
import ApprovalDock, { ACTION_LABEL } from "./room/ApprovalDock";
import Dashboard, { type StageView } from "./room/Dashboard";
import ViewSwitch, { VIEWS } from "./room/ViewSwitch";
import { RoomMap, Timeline } from "./room/viz";
import Composer, { type ComposerHandle } from "./room/Composer";
import Header from "./room/Header";
import People from "./room/People";
import SettingsModal from "./room/SettingsModal";
import Thread, { WaitingForAgents, mentionsHuman } from "./room/Thread";
import { modelLine, toMentionAgent, type Delivery } from "./room/mentions";
import { AUDIT_LABELS, ActivityPanel, ChangesPanel, ClaimsPanel, NotesPanel, TasksPanel, auditDetail } from "./room/panels";

type Tab = "claims" | "tasks" | "changes" | "notes" | "activity";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "claims", label: "Claims", icon: "lock" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "changes", label: "Changes", icon: "diff" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "activity", label: "Activity", icon: "activity" },
];

const notify = desktopNotify;

/** Who each of the human's messages reached, per room, for this browser session. */
function loadDeliveries(roomId: string): Map<number, Delivery[]> {
  try {
    const raw = sessionStorage.getItem(`bothread.deliveries.${roomId}`);
    return new Map(raw ? (JSON.parse(raw) as [number, Delivery[]][]) : []);
  } catch {
    return new Map();
  }
}
function saveDeliveries(roomId: string, m: Map<number, Delivery[]>) {
  try {
    sessionStorage.setItem(`bothread.deliveries.${roomId}`, JSON.stringify([...m].slice(-80)));
  } catch {
    /* not persisted */
  }
}

export default function RoomView({
  roomId,
  onBack,
  theme,
  onToggleTheme,
}: {
  roomId: string;
  onBack: () => void;
  onOpenRoom?: (id: string) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const toast = useToast();
  const now = useNow(10_000);
  const [tab, setTab] = usePref<Tab>("tab", "claims");
  const [panelPref, setPanelPref] = usePref<"open" | "closed">("panel", "open");
  // Narrow screens get a drawer that starts closed and isn't remembered, so a
  // desktop preference never leaves a phone staring at a panel over the thread.
  const narrow = useMedia("(max-width: 1080px)");
  const [drawer, setDrawer] = useState<"open" | "closed">("closed");
  const panel = narrow ? drawer : panelPref;
  const setPanel = narrow ? setDrawer : setPanelPref;
  const [notifyPref, setNotifyPref] = usePref<"on" | "off">("notify", "off");
  const [chimePref, setChimePref] = usePref<"on" | "off">("chime", "on");
  const [focusAgent, setFocusAgent] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Map<number, Delivery[]>>(() => loadDeliveries(roomId));
  const overseerNameRef = useRef("You");
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadEntry | null>(null);
  const [branches, setBranches] = useState<AgentBranch[]>([]);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [tick, setTick] = useState(0);
  const [unread, setUnread] = useState(0);
  const [view, setView] = usePref<StageView>("view", "thread");
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const gAt = useRef(0);
  const composer = useRef<ComposerHandle>(null);
  const knownAgents = useRef<Set<string> | null>(null);

  const loadBranches = useCallback(() => {
    listBranches(roomId, showAllBranches).then(setBranches).catch(() => null);
  }, [roomId, showAllBranches]);
  useEffect(loadBranches, [loadBranches]);

  const onEvent = useCallback(
    (ev: ServerEvent) => {
      setTick((t) => t + 1);
      setEvents((list) => (list.length >= 200 ? [...list.slice(-199), ev] : [...list, ev]));
      const d = ev.data as Record<string, unknown>;
      if (ev.type === "branch" || ev.type === "lease") loadBranches();
      if (ev.type === "participant") {
        const p = d.participant as { id: string; name: string; kind: string; status: string } | undefined;
        if (p && p.kind === "agent" && p.status === "active" && knownAgents.current && !knownAgents.current.has(p.id)) {
          knownAgents.current.add(p.id);
          toast.show({ tone: "success", title: `${p.name} joined the room` });
        }
      }
      if (ev.type === "collision") {
        const c = (d.conflicts as { path: string; heldByName: string }[] | undefined)?.[0];
        if (c) toast.show({ tone: "warn", title: "Collision prevented", body: `${d.by} tried to claim ${c.path}, which ${c.heldByName} holds.` });
      }
      if (ev.type === "approval") {
        const a = d.approval as Approval | undefined;
        if (a?.status === "pending") {
          toast.show({ tone: "warn", title: `${a.requestedByName} needs your OK`, body: `Wants to ${ACTION_LABEL[a.action] ?? a.action}.` });
          notify(`${a.requestedByName} needs your OK`, a.details.slice(0, 140), notifyPref === "on");
        }
      }
      if (ev.type === "branch") {
        const b = d.branch as AgentBranch | undefined;
        if (b?.status === "ready")
          toast.show({
            tone: "info",
            title: `${b.participantName}'s changes are ready`,
            action: { label: "Review", run: () => (setPanel("open"), setTab("changes")) },
          });
      }
      if (ev.type === "message") {
        const m = d.message as
          | { kind: string; importance: string; authorName: string; text: string; seq: number; mentions?: string[]; retractedAt?: number; editedAt?: number }
          | undefined;
        if (m && m.kind !== "system" && document.hidden && !m.editedAt) setUnread((u) => u + 1);
        if (m && m.kind === "agent" && !m.retractedAt && !m.editedAt) {
          const atYou = mentionsHuman({ mentions: m.mentions ?? [], text: m.text }, overseerNameRef.current);
          if (atYou || m.importance === "interrupt") {
            const title = atYou ? `${m.authorName} mentioned you` : `${m.authorName} needs a decision`;
            if (chimePref === "on") chime();
            notify(title, m.text.slice(0, 140), notifyPref === "on");
            flashTitle(title);
          }
        }
      }
    },
    [toast, loadBranches, notifyPref, chimePref, setPanel, setTab]
  );

  const { detail, connected, refresh, error } = useRoom(roomId, onEvent);

  // The audit trail feeds the visual views, the Activity tab and "what is each agent
  // doing right now" (the newest meaningful audit event per actor). One debounced fetch.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      getAudit(roomId, 300)
        .then((list: AuditEvent[]) => alive && setAudit(list))
        .catch(() => null);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [roomId, tick]);
  const doing = useMemo(() => {
    const m = new Map<string, { label: string; ts: number }>();
    for (const e of audit) {
      if (!e.actorName || m.has(e.actorName) || e.type === "participant.nudge") continue;
      const base = e.type === "message.send" ? "Wrote in the thread" : AUDIT_LABELS[e.type] ?? e.type;
      const d = auditDetail(e);
      m.set(e.actorName, { label: d && e.type !== "message.send" ? `${base} ${d}` : base, ts: e.ts });
    }
    return m;
  }, [audit]);

  useEffect(() => {
    if (detail && !knownAgents.current) knownAgents.current = new Set(detail.snapshot.participants.map((p) => p.id));
  }, [detail]);
  useEffect(() => {
    knownAgents.current = null;
    setEvents([]);
    setAudit([]);
    setReplyTo(null);
    setFocusAgent(null);
    setDeliveries(loadDeliveries(roomId));
  }, [roomId]);

  const recordDelivery = useCallback(
    (seq: number, list: Delivery[]) =>
      setDeliveries((prev) => {
        const next = new Map(prev);
        next.set(seq, list);
        saveDeliveries(roomId, next);
        return next;
      }),
    [roomId]
  );

  useEffect(() => {
    const onVis = () => !document.hidden && setUnread(0);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const snapshot = detail?.snapshot;
  const pendingApprovals = detail?.pendingApprovals ?? [];
  const agents = useMemo(() => (snapshot?.participants ?? []).filter((p) => p.kind === "agent"), [snapshot]);
  const liveAgents = agents.filter((a) => a.status !== "left" && a.status !== "revoked");
  const overseer = snapshot?.participants.find((p) => p.kind === "human");
  overseerNameRef.current = overseer?.name ?? "You";
  const mentionAgents = useMemo(() => agents.filter((a) => a.status !== "revoked").map(toMentionAgent), [agents]);
  const readyChanges = branches.filter((b) => b.status === "ready").length;
  const activity = useMemo(() => {
    const m = new Map<string, number[]>();
    const thread = snapshot?.thread ?? [];
    for (const a of agents)
      m.set(
        a.name,
        bucketize(
          thread.filter((x) => x.author === a.name && x.kind === "agent").map((x) => x.at),
          now,
          10 * 60_000,
          10
        )
      );
    return m;
  }, [agents, snapshot, now]);

  // Tab title carries what needs you: approvals first, then unread while away.
  useEffect(() => {
    if (!snapshot) return;
    const badge = pendingApprovals.length ? `(${pendingApprovals.length}!) ` : unread ? `(${unread}) ` : "";
    setBaseTitle(`${badge}${snapshot.room.name} | Bothread`);
  }, [snapshot, pendingApprovals.length, unread]);

  const togglePause = async () => {
    if (!snapshot) return;
    const paused = snapshot.room.status === "paused";
    try {
      await setRoomStatus(roomId, paused ? "active" : "paused");
      toast.show({ tone: paused ? "success" : "warn", title: paused ? "Room resumed" : "Room paused", body: paused ? undefined : "Agents can read but can't act until you resume." });
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  const openTab = (t: Tab) => {
    setTab(t);
    setPanel("open");
  };
  const chord = (v: StageView) => {
    if (Date.now() - gAt.current > 1500) return;
    gAt.current = 0;
    setView(v);
  };
  const focusApproval = () => {
    const el = document.querySelector<HTMLElement>(".approval");
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.querySelector<HTMLElement>(".btn.primary")?.focus();
  };
  const selectAgent = (name: string) => {
    setFocusAgent(name);
    setView("thread");
  };

  useHotkeys({
    "/": () => composer.current?.focus(),
    c: () => setShowConnect(true),
    "shift+p": togglePause,
    "1": () => openTab("claims"),
    "2": () => openTab("tasks"),
    "3": () => openTab("changes"),
    "4": () => openTab("notes"),
    "5": () => openTab("activity"),
    "]": () => setPanel(panel === "open" ? "closed" : "open"),
    // View chords: G then T (thread), M (map) or L (timeline).
    g: () => (gAt.current = Date.now()),
    t: () => chord("thread"),
    m: () => chord("map"),
    l: () => chord("timeline"),
  });

  usePaletteActions("room", [
    { id: "connect", group: "Room", label: "Connect an agent", icon: "plus", hint: "C", run: () => setShowConnect(true) },
    {
      id: "pause",
      group: "Room",
      label: snapshot?.room.status === "paused" ? "Resume the room" : "Pause the room",
      icon: snapshot?.room.status === "paused" ? "play" : "pause",
      hint: "Shift P",
      run: togglePause,
    },
    { id: "write", group: "Room", label: "Write to the room", icon: "send", hint: "/", run: () => composer.current?.focus() },
    { id: "settings", group: "Room", label: "Room settings", icon: "gear", keywords: "approval gates ttl notifications delete", run: () => setShowSettings(true) },
    { id: "panel", group: "View", label: panel === "open" ? "Hide side panel" : "Show side panel", icon: "panel", hint: "]", run: () => setPanel(panel === "open" ? "closed" : "open") },
    {
      id: "theme-room",
      group: "View",
      label: theme === "dark" ? "Light theme" : "Dark theme",
      icon: theme === "dark" ? "sun" : "moon",
      run: onToggleTheme,
    },
    ...VIEWS.map((v) => ({
      id: `view-${v.id}`,
      group: "View",
      label: `${v.label} view`,
      icon: v.icon,
      hint: `G ${v.key}`,
      keywords: v.id === "map" ? "graph who holds what" : v.id === "timeline" ? "history lanes events" : "chat messages",
      run: () => setView(v.id),
    })),
    ...TABS.map((t, i) => ({ id: `tab-${t.id}`, group: "View", label: `Show ${t.label}`, icon: t.icon, hint: String(i + 1), run: () => openTab(t.id) })),
    ...liveAgents.map((a) => ({
      id: `mention-${a.id}`,
      group: "Agents",
      label: `Message ${a.name}`,
      icon: "reply" as const,
      run: () => composer.current?.mention(a.name),
    })),
    ...liveAgents.map((a) => ({
      id: `ping-${a.id}`,
      group: "Agents",
      label: `Ping ${a.name} (stop and read)`,
      icon: "zap" as const,
      run: () => composer.current?.ping(a.name),
    })),
    ...liveAgents.map((a) => ({
      id: `focus-${a.id}`,
      group: "Agents",
      label: `Show only ${a.name}'s messages`,
      icon: "search" as const,
      run: () => setFocusAgent(a.name),
    })),
  ]);

  if (error) {
    return (
      <div className="room-missing">
        <Empty icon={<Icon name="alert" size={24} />} title="Room not found">
          {error}
        </Empty>
        <button className="btn" onClick={onBack}>
          <Icon name="back" size={14} /> All rooms
        </button>
      </div>
    );
  }

  if (!detail || !snapshot) {
    return (
      <div className="room loading" aria-busy="true">
        <div className="rhead skeleton-bar" />
        <div className="dash dash-skeleton" />
        <div className="room-body">
          <div className="people skeleton" />
          <div className="stage skeleton" />
          <div className="side skeleton" />
        </div>
      </div>
    );
  }

  const paused = snapshot.room.status === "paused";
  const brandByName = new Map(snapshot.participants.map((p) => [p.name, p.brand]));
  const names = snapshot.participants.map((p) => p.name);
  const modelByName = new Map(snapshot.participants.map((p) => [p.name, modelLine(p)] as const).filter(([, m]) => !!m));
  const counts: Record<Tab, number> = {
    claims: snapshot.locks.length,
    tasks: snapshot.tasks.filter((t) => t.status === "open" || t.status === "in_progress").length,
    changes: readyChanges,
    notes: snapshot.notes.filter((n) => n.status === "open").length,
    activity: 0,
  };

  return (
    <div className={`room${panel === "open" ? "" : " panel-closed"}`}>
      <Header
        roomId={roomId}
        name={snapshot.room.name}
        status={snapshot.room.status}
        sessionId={detail.sessionId}
        connected={connected}
        agents={agents}
        onBack={onBack}
        afterAction={refresh}
        onConnect={() => setShowConnect(true)}
        onSettings={() => setShowSettings(true)}
        panelOpen={panel === "open"}
        onTogglePanel={() => setPanel(panel === "open" ? "closed" : "open")}
      />
      <Dashboard
        snapshot={snapshot}
        branches={branches}
        approvals={pendingApprovals}
        now={now}
        onOpenTab={openTab}
        onView={setView}
        onApprovals={focusApproval}
      />

      <div className="room-body">
        <People
          roomId={roomId}
          participants={snapshot.participants}
          now={now}
          afterAction={refresh}
          onConnect={() => setShowConnect(true)}
          onMention={(n) => composer.current?.mention(n)}
          onPing={(n) => composer.current?.ping(n)}
          focused={focusAgent}
          onFocusAgent={setFocusAgent}
          doing={doing}
          activity={activity}
        />

        <main className={`stage view-${view}`}>
          <div className="stage-weave" aria-hidden="true" />
          {paused && (
            <div className="banner paused" role="status">
              <Icon name="pause" size={15} />
              <span>
                <strong>Paused.</strong> Agents can read the room but every action waits until you resume.
              </span>
              <button className="btn sm" onClick={togglePause}>
                <Icon name="play" size={12} /> Resume
              </button>
            </div>
          )}
          {snapshot.room.name.startsWith("Demo:") && (
            <div className="banner demo" role="note">
              <Icon name="sparkle" size={15} />
              <span>These are simulated agents. Connect your own with Connect agent.</span>
              <button className="btn sm" onClick={() => setShowConnect(true)}>
                Connect agent
              </button>
            </div>
          )}
          {view !== "thread" && (
            <div className="stage-bar">
              <ViewSwitch view={view} onChange={setView} />
              <span className="stage-bar-hint">{view === "map" ? "Who holds what, right now. Click an agent to read its messages." : "Every move in the room, lane by agent."}</span>
            </div>
          )}
          {view !== "thread" && (
            <div className="viz-wrap">
              {(() => {
                const vizProps = {
                  roomId,
                  snapshot,
                  leases: detail.leases,
                  branches,
                  events,
                  audit,
                  theme,
                  onSelectAgent: selectAgent,
                  onOpenTab: openTab,
                };
                return view === "map" ? <RoomMap {...vizProps} /> : <Timeline {...vizProps} />;
              })()}
            </div>
          )}
          <div className="thread-host" hidden={view !== "thread"}>
            <Thread
              roomId={roomId}
              thread={snapshot.thread}
              brandByName={brandByName}
              names={names}
              overseerName={overseer?.name ?? "You"}
              channels={snapshot.channels}
              hasAgents={agents.length > 0}
              empty={<WaitingForAgents sessionId={detail.sessionId} onConnect={() => setShowConnect(true)} />}
              onReply={setReplyTo}
              modelByName={modelByName}
              deliveries={deliveries}
              focusAgent={focusAgent}
              onClearFocus={() => setFocusAgent(null)}
              tasks={snapshot.tasks}
              approvals={pendingApprovals}
              active={view === "thread"}
              toolbarStart={<ViewSwitch view={view} onChange={setView} />}
            />
          </div>
          {pendingApprovals.length > 0 && <ApprovalDock key={pendingApprovals[0]!.id} roomId={roomId} approvals={pendingApprovals} now={now} afterDecide={refresh} agents={mentionAgents} names={names} compact={view !== "thread"} />}
          <Composer
            ref={composer}
            roomId={roomId}
            paused={paused}
            agents={mentionAgents}
            onSent={recordDelivery}
            channels={snapshot.channels}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            afterSend={refresh}
          />
        </main>

        {narrow && panel === "open" && <div className="scrim" onClick={() => setPanel("closed")} aria-hidden="true" />}
        <aside className="side" aria-label="Room details">
          <div className="tabs" role="tablist">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? " on" : ""}`}
                onClick={() => setTab(t.id)}
                title={`${t.label} (${i + 1})`}
              >
                <Icon name={t.icon} size={14} />
                <span className={`tab-label${tab === t.id ? "" : " inactive"}`}>{t.label}</span>
                {counts[t.id] > 0 && <span className={`tab-count${t.id === "changes" ? " hot" : ""}`}>{counts[t.id]}</span>}
              </button>
            ))}
          </div>
          <div className="side-scroll" role="tabpanel">
            {tab === "claims" && <ClaimsPanel locks={snapshot.locks} leases={detail.leases} handoffs={snapshot.handoffs} brandByName={brandByName} now={now} />}
            {tab === "tasks" && <TasksPanel roomId={roomId} tasks={snapshot.tasks} afterAction={refresh} brandByName={brandByName} />}
            {tab === "changes" && (
              <ChangesPanel
                roomId={roomId}
                branches={branches}
                hasProject={!!detail.room?.projectPath}
                showAll={showAllBranches}
                brandByName={brandByName}
                onToggleAll={() => setShowAllBranches((s) => !s)}
                afterAction={() => {
                  loadBranches();
                  refresh();
                }}
              />
            )}
            {tab === "notes" && <NotesPanel roomId={roomId} notes={snapshot.notes} afterAction={refresh} />}
            {tab === "activity" && <ActivityPanel roomId={roomId} tick={tick} events={audit} brandByName={brandByName} />}
          </div>
        </aside>
      </div>

      {showConnect && <ConnectPanel sessionId={detail.sessionId} participants={snapshot.participants} onClose={() => setShowConnect(false)} />}

      {showSettings && (
        <SettingsModal
          roomId={roomId}
          roomName={snapshot.room.name}
          requireApprovalFor={snapshot.room.requireApprovalFor}
          leaseTtlMs={detail.room?.settings.defaultLeaseTtlMs}
          notify={notifyPref}
          onNotifyChange={setNotifyPref}
          chime={chimePref}
          onChimeChange={setChimePref}
          onClose={() => setShowSettings(false)}
          afterSave={refresh}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}
