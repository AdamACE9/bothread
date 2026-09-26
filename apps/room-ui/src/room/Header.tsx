import { useState } from "react";
import type { ParticipantView, RoomStatus } from "@bothread/shared";
import { renameRoom, setRoomStatus } from "../api";
import { copyText, modKey } from "../hooks";
import { Icon } from "../icons";
import { usePalette } from "../palette";
import { useToast } from "../toast";
import { Avatar, presence } from "../ui";

export default function Header(props: {
  roomId: string;
  name: string;
  status: RoomStatus;
  sessionId: string;
  connected: boolean;
  agents: ParticipantView[];
  overseerActive?: boolean;
  onBack: () => void;
  afterAction: () => void;
  onConnect: () => void;
  onSettings: () => void;
  onTogglePanel: () => void;
  panelOpen: boolean;
}) {
  const toast = useToast();
  const palette = usePalette();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(props.name);
  const paused = props.status === "paused";
  const live = props.agents.filter((a) => a.status !== "left" && a.status !== "revoked");

  const copy = async () => {
    if (await copyText(props.sessionId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === props.name) return;
    try {
      await renameRoom(props.roomId, next);
      props.afterAction();
    } catch (err) {
      toast.error(err, "Couldn't rename the room");
    }
  };

  const togglePause = async () => {
    try {
      await setRoomStatus(props.roomId, paused ? "active" : "paused");
      props.afterAction();
    } catch (err) {
      toast.error(err, paused ? "Couldn't resume" : "Couldn't pause");
    }
  };

  return (
    <header className="rhead">
      <div className="rhead-left">
        <button className="icon-btn" onClick={props.onBack} aria-label="All rooms" title="All rooms">
          <Icon name="back" size={18} />
        </button>
        {editingName ? (
          <input
            className="field room-name-edit"
            autoFocus
            value={nameDraft}
            maxLength={80}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveName();
              } else if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <h1
            className="room-name"
            title="Click to rename"
            tabIndex={0}
            onClick={() => {
              setNameDraft(props.name);
              setEditingName(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setNameDraft(props.name);
                setEditingName(true);
              }
            }}
          >
            {props.name}
          </h1>
        )}
        {props.name.startsWith("Demo:") && <span className="demo-badge" title="Simulated agents, for a quick look around">Demo</span>}
        <span className={`live-chip ${!props.connected ? "off" : paused ? "paused" : "on"}`} aria-live="polite">
          <span className="live-dot" />
          {!props.connected ? "Reconnecting" : paused ? "Paused" : "Live"}
        </span>
      </div>

      <div className="presence" aria-label={`${live.length} agents in the room`}>
        {live.slice(0, 6).map((a) => (
          <span key={a.id} className="presence-av" title={`${a.name}${a.listening ? " (listening)" : a.idle ? " (idle)" : ""}`}>
            <Avatar name={a.name} brand={a.brand} size={28} ring={presence(a)} />
          </span>
        ))}
        {live.length > 6 && <span className="presence-more">+{live.length - 6}</span>}
        {live.length === 0 && <span className="presence-none">No agents yet</span>}
      </div>

      <span className="spacer" />

      <div className="rhead-right">
        <div className={`sid${reveal ? " shown" : ""}`} title="Session ID: the room's join credential">
          <span className="sid-label">Session</span>
          <code>{reveal ? props.sessionId : "••••••••••••"}</code>
          <button className="icon-btn sm" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Hide session ID" : "Reveal session ID"}>
            <Icon name={reveal ? "eyeOff" : "eye"} size={14} />
          </button>
          <button className="icon-btn sm" onClick={copy} aria-label="Copy session ID">
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        </div>

        <button className={`btn${paused ? " resume" : ""}`} onClick={togglePause} title={`${paused ? "Resume" : "Pause"} the room (Shift+P)`}>
          <Icon name={paused ? "play" : "pause"} size={14} />
          {paused ? "Resume" : "Pause"}
        </button>
        <button className="btn primary" onClick={props.onConnect} title="Connect an agent (C)">
          <Icon name="plus" size={15} />
          Connect agent
        </button>
        <span className="rhead-sep" />
        <button className="icon-btn" onClick={palette.open} aria-label="Command palette" title={`Commands (${modKey}K)`}>
          <Icon name="command" />
        </button>
        <button className="icon-btn" onClick={props.onSettings} aria-label="Room settings" title="Room settings">
          <Icon name="gear" />
        </button>
        <button
          className={`icon-btn${props.panelOpen ? " on" : ""}`}
          onClick={props.onTogglePanel}
          aria-label="Toggle side panel"
          aria-pressed={props.panelOpen}
          title="Toggle side panel"
        >
          <Icon name="panel" />
        </button>
      </div>
    </header>
  );
}
