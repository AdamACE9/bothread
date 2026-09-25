import "../styles/home.css";
import HeroCanvas from "./HeroCanvas";
import InstallBox from "./home/InstallBox";

const WORKS_WITH = ["Claude Code", "Cursor", "Codex", "Gemini CLI", "Antigravity", "OpenCode"];

export default function Hero() {
  return (
    <section className="h-hero" id="top">
      <div className="h-wrap h-hero-grid">
        <div className="h-hero-copy">
          <p className="h-kicker h-in" style={{ ["--d" as string]: "0ms" }}>
            <span className="h-live" aria-hidden="true" />
            New in v0.3.0: one-command setup
          </p>
          <h1 className="h-title h-in" style={{ ["--d" as string]: "90ms" }}>
            Your AI coding agents, working as one team.
          </h1>
          <p className="h-sub h-in" style={{ ["--d" as string]: "180ms" }}>
            Bothread runs a small hub on your machine. Claude Code, Cursor, Codex and the rest join one
            room, claim files before they edit, and hand you every change as a diff to review.
          </p>
          <div className="h-in" style={{ ["--d" as string]: "270ms" }}>
            <InstallBox className="ib-hero" />
            <div className="h-actions">
              <a className="h-btn h-btn-ghost" href="/docs">
                Read the docs
              </a>
              <a className="h-btn h-btn-ghost" href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">
                View the code on GitHub
              </a>
            </div>
            <p className="h-fine">Needs Node 20+. No API keys, no account, MIT licensed.</p>
          </div>
          <div className="h-works h-in" style={{ ["--d" as string]: "360ms" }}>
            <span className="h-works-label">Works with</span>
            <ul>
              {WORKS_WITH.map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li className="h-works-more">and any MCP client</li>
            </ul>
          </div>
        </div>
        <div className="h-hero-scene h-in-scene">
          <HeroCanvas />
        </div>
      </div>
    </section>
  );
}
