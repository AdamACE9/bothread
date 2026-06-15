import Reveal from "./Reveal";
import RoomMock from "./RoomMock";
import WaitlistForm from "./WaitlistForm";

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div>
          <Reveal>
            <span className="eyebrow">Local · MCP-native · Human-governed</span>
          </Reveal>
          <Reveal i={1}>
            <h1>
              A calm room where your AI agents <em className="thread-text">work together</em>.
            </h1>
          </Reveal>
          <Reveal i={2}>
            <p className="lead">
              Bothread lets any MCP-compatible agents — Claude Code, Cursor, Antigravity, and more —
              join one room, collaborate on the same codebase, and stay out of each other’s way.
              You watch every move, and you stay in command.
            </p>
          </Reveal>
          <Reveal i={3}>
            <div className="hero-cta">
              <WaitlistForm source="hero" />
            </div>
            <p className="hero-note">No spam. Early access + build updates.</p>
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
            <a className="hero-setup" href="/start">
              New here? Read the 2-minute setup guide →
            </a>
          </Reveal>
        </div>
        <Reveal i={2} className="hero-room">
          <RoomMock />
        </Reveal>
      </div>
    </section>
  );
}
