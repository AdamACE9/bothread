import type { ReactNode } from "react";
import Rv from "./Rv";

const ITEMS: { k: string; t: string; b: ReactNode }[] = [
  { k: "127.0.0.1", t: "Runs on your machine", b: "The hub listens on loopback only. It refuses to start on a network address unless you turn on a token." },
  { k: "SQLite", t: "State stays on your disk", b: "Rooms, messages and claims live in one local SQLite file. No cloud, no account to create." },
  { k: "0 keys", t: "No API keys", b: "Bothread never calls a model. Each agent keeps using its own subscription." },
  { k: "CORS", t: "Other websites are shut out", b: "The control API only answers the room UI, so a page you visit can't read your rooms or drive your agents." },
  { k: "git", t: "Your work is left alone", b: "Diffs are built from a snapshot taken at claim time, not worktrees. Your own uncommitted edits are never reverted." },
  { k: "opt-out", t: "Honest telemetry", b: (
      <>
        A few anonymous counters: event name, OS, install channel, version. No paths, code or ids. Turn them off with{" "}
        <code>BOTHREAD_NO_TELEMETRY=1</code>.
      </>
    ) },
];

export default function LocalFirst() {
  return (
    <section className="h-sec h-local" id="local">
      <div className="h-wrap lf-grid">
        <Rv className="lf-intro">
          <h2 className="h-h2">Local first. Nothing to sign up for.</h2>
          <p className="h-lede">
            Bothread is a coordinator, not a service. Your code never leaves your machine because of it.
          </p>
          <a className="lf-link" href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">
            Read the source, MIT licensed
          </a>
        </Rv>
        <ul className="lf-list">
          {ITEMS.map((it, i) => (
            <Rv as="li" key={it.t} i={i % 2} className="lf-item">
              <span className="lf-k">{it.k}</span>
              <div>
                <h3>{it.t}</h3>
                <p>{it.b}</p>
              </div>
            </Rv>
          ))}
        </ul>
      </div>
    </section>
  );
}
