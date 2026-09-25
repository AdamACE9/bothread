import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentBranch, Approval, AuditEvent, ServerEvent, ThreadEntry } from "@bothread/shared";
import { getAudit, listBranches, setRoomStatus } from "./api";
import ConnectPanel from "./ConnectPanel";
import { useMedia, usePref, useNow } from "./hooks";
import { Icon, type IconName } from "./icons";
import { useHotkeys, usePaletteActions } from "./palette";
import { useToast } from "./toast";
import { Empty } from "./ui";
import { useRoom } from "./useRoom";
import ApprovalDock, { ACTION_LABEL } from "./room/ApprovalDock";
import Composer, { type ComposerHandle } from "./room/Composer";
import Header from "./room/Header";
import People from "./room/People";
import SettingsModal from "./room/SettingsModal";
import Thread, { WaitingForAgents } from "./room/Thread";
import { AUDIT_LABELS, ActivityPanel, ChangesPanel, ClaimsPanel, NotesPanel, TasksPanel, auditDetail } from "./room/panels";

type Tab = "claims" | "tasks" | "changes" | "notes" | "activity";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "claims", label: "Claims", icon: "lock" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "changes", label: "Changes", icon: "diff" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "activity", label: "Activity", icon: "activity" },
];

function notify(title: string, body: string, enabled: boolean) {
  if (!enabled || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/favicon.svg", tag: title });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
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
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadEntry | null>(null);
  const [branches, setBranches] = useState<AgentBranch[]>([]);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [tick, setTick] = useState(0);
  const [unread, setUnread] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const knownAgents = useRef<Set<string> | null>(null);

  const loadBranches = useCallback(() => {
    listBranches(roomId, showAllBranches).then(setBranches).catch(() => null);
  }, [roomId, showAllBranches]);
  useEffect(loadBranches, [loadBranches]);

  const onEvent = useCallback(
    (ev: ServerEvent) => {
      setTick((t) => t + 1);
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
        const m = d.message as { kind: string; importance: string; authorName: string; text: string; seq: number } | undefined;
        if (m && m.kind !== "system" && document.hidden) setUnread((u) => u + 1);
        if (m && m.kind === "agent" && m.importance === "interrupt") notify(`${m.authorName} needs a decision`, m.text.slice(0, 140), notifyPref === "on");
      }
    },
    [toast, loadBranches, notifyPref, setPanel, setTab]
  );

  const { detail, connected, refresh, error } = useRoom(roomId, onEvent);

  // "What is each agent doing right now": the newest meaningful audit event per actor.
  const [doing, setDoing] = useState<Map<string, { label: string; ts: number }>>(new Map());
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      getAudit(roomId, 120)
        .then((events: AuditEvent[]) => {
          if (!alive) return;
          const m = new Map<string, { label: string; ts: number }>();
          for (const e of events) {
            if (!e.actorName || m.has(e.actorName) || e.type === "participant.nudge") continue;
            const base = AUDIT_LABELS[e.type] ?? e.type;
            const d = auditDetail(e);
            m.set(e.actorName, { label: d && e.type !== "message.send" ? `${base} ${d}` : base, ts: e.ts });
          }
          setDoing(m);
        })
        .catch(() => null);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [roomId, tick]);

  useEffect(() => {
    if (detail && !knownAgents.current) knownAgents.current = new Set(detail.snapshot.participants.map((p) => p.id));
  }, [detail]);
  useEffect(() => {
    knownAgents.current = null;
    setReplyTo(null);
  }, [roomId]);

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
  const readyChanges = branches.filter((b) => b.status === "ready").length;

  // Tab title carries what needs you: approvals first, then unread while away.
  useEffect(() => {
    if (!snapshot) return;
    const badge = pendingApprovals.length ? `(${pendingApprovals.length}!) ` : unread ? `(${unread}) ` : "";
    document.title = `${badge}${snapshot.room.name} | Bothread`;
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
    ...TABS.map((t, i) => ({ id: `tab-${t.id}`, group: "View", label: `Show ${t.label}`, icon: t.icon, hint: String(i + 1), run: () => openTab(t.id) })),
    ...liveAgents.map((a) => ({
      id: `mention-${a.id}`,
      group: "Agents",
      label: `Message ${a.name}`,
      icon: "reply" as const,
      run: () => composer.current?.mention(a.name),
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

      <div className="room-body">
        <People
          roomId={roomId}
          participants={snapshot.participants}
          now={now}
          afterAction={refresh}
          onConnect={() => setShowConnect(true)}
          onMention={(n) => composer.current?.mention(n)}
          doing={doing}
        />

        <main className="stage">
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
          />
          {pendingApprovals.length > 0 && <ApprovalDock key={pendingApprovals[0]!.id} roomId={roomId} approvals={pendingApprovals} now={now} afterDecide={refresh} />}
          <Composer
            ref={composer}
            roomId={roomId}
            paused={paused}
            agents={liveAgents.map((a) => ({ name: a.name, brand: a.brand }))}
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
            {tab === "tasks" && <TasksPanel roomId={roomId} tasks={snapshot.tasks} afterAction={refresh} />}
            {tab === "changes" && (
              <ChangesPanel
                roomId={roomId}
                branches={branches}
                hasProject={!!detail.room?.projectPath}
                showAll={showAllBranches}
                onToggleAll={() => setShowAllBranches((s) => !s)}
                afterAction={() => {
                  loadBranches();
                  refresh();
                }}
              />
            )}
            {tab === "notes" && <NotesPanel roomId={roomId} notes={snapshot.notes} afterAction={refresh} />}
            {tab === "activity" && <ActivityPanel roomId={roomId} tick={tick} />}
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
          onClose={() => setShowSettings(false)}
          afterSave={refresh}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}
