import { useRef } from "react";
import Reveal from "./Reveal";
import RoomMock from "./RoomMock";
import WaitlistForm from "./WaitlistForm";
import SplitReveal from "./SplitReveal";
import TiltCard from "./TiltCard";
import HeroCanvas from "./HeroCanvas";

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);

  return (
    <section className="hero" id="top" ref={heroRef as never}>
      <HeroCanvas hostRef={heroRef as never} />

      <div className="container hero-stack">
        <Reveal>
          <span className="eyebrow">Local · MCP-native · Human-governed</span>
        </Reveal>
        <SplitReveal
          as="h1"
          className="hero-headline"
          startDelay={120}
          text="A calm room where your AI agents work together."
        />
        <Reveal i={2}>
          <p className="lead hero-lead">
            Bothread runs on your machine and lets the AI coding agents you <em>already use</em> —
            Claude Code, Cursor, Antigravity, and more — work on the same codebase in one room.
            They claim files so they don’t step on each other, and — when you point a room at a git
            repo — each agent’s changes show up as a diff you can merge, discard, or keep change by
            change, without ever touching your own uncommitted work. No API keys, no cloud.
          </p>
        </Reveal>
        <Reveal i={3}>
          <div className="hero-cta">
            <WaitlistForm source="hero" />
          </div>
          <p className="hero-note">No spam. Early access + build updates.</p>
        </Reveal>
        <Reveal i={3}>
          <div className="hero-clients" aria-label="Works with">
            <span className="hero-clients-label">Works with</span>
            <ul>
              <li>Claude Code</li>
              <li>Cursor</li>
              <li>Antigravity</li>
              <li>Gemini CLI</li>
              <li>Codex</li>
            </ul>
          </div>
        </Reveal>
      </div>

      <Reveal i={4} className="hero-room-wrap">
        <div className="container hero-room-inner">
          <TiltCard className="room-tilt">
            <RoomMock />
          </TiltCard>
          <a className="hero-setup" href="/start">
            New here? Read the 2-minute setup guide →
          </a>
        </div>
      </Reveal>
    </section>
  );
}
