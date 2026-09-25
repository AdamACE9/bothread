import { useEffect, useRef, useState, type ReactNode } from "react";
import "../styles/content.css";

/* ------------------------------------------------------------------ */
/* Copyable code                                                        */
/* ------------------------------------------------------------------ */

/** Strip a trailing `  # comment` from each line before it hits the clipboard,
 *  so a multi-line paste doesn't choke on inline comments. */
function stripComments(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/\s+#(?!!).*$/, ""))
    .join("\n");
}

function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <pre>{children}</pre>
      <button
        className="copybtn"
        aria-label={label ? `Copy ${label}` : "Copy"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(stripComments(children));
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard blocked: the text is still selectable */
          }
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

/** A one-line shell command, shown with a `$` prompt (the prompt isn't copied). */
function Cmd({ children }: { children: string }) {
  return (
    <div className="gs-cmd">
      <Code label="command">{children}</Code>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Terminal replay                                                      */
/* ------------------------------------------------------------------ */

type Seg = string | [cls: "g" | "c" | "y" | "d" | "b" | "p", text: string];
type TLine = { segs: Seg[]; pause?: number };

const G = (t: string): Seg => ["g", t];
const C = (t: string): Seg => ["c", t];
const D = (t: string): Seg => ["d", t];
const B = (t: string): Seg => ["b", t];
const P = (t: string): Seg => ["p", t];
const bar = D("│");
const l = (...segs: Seg[]): TLine => ({ segs });
const wait = (ms: number, ...segs: Seg[]): TLine => ({ segs, pause: ms });

/** Real output of `npx bothread setup` on a machine with Claude Code, Cursor and
 *  Codex installed (captured from 0.3.0; backup timestamps shortened). */
const SETUP_REPLAY: TLine[] = [
  l(P("$ "), B("npx bothread setup")),
  wait(500, D("┌"), "  Connect your AI agents to Bothread"),
  l(bar),
  wait(600, G("◇"), "  Found 3 AI coding agents on this computer"),
  l(bar, "  ", G("●"), " Claude Code           ", D("~/.claude.json")),
  l(bar, "  ", D("·"), D(" Claude (desktop app)  not found")),
  l(bar, "  ", D("·"), D(" Antigravity           not found")),
  l(bar, "  ", G("●"), " Cursor                ", D("~/.cursor/mcp.json")),
  l(bar, "  ", D("·"), D(" Gemini CLI            not found")),
  l(bar, "  ", G("●"), " Codex                 ", D("~/.codex/config.toml")),
  l(bar, "  ", D("·"), D(" OpenCode · Windsurf · VS Code · Zed   not found")),
  l(bar),
  wait(500, G("◇"), "  Which agents should Bothread connect?"),
  l(bar, "  ", D("Claude Code, Cursor, Codex")),
  l(bar),
  wait(400, G("◇"), "  Here's the plan ", D("─────────────────────────────────────────────────────╮")),
  l(bar, "  Claude Code  ", D("→"), " ~/.claude.json"),
  l(bar, "  Cursor       ", D("→"), " ~/.cursor/mcp.json"),
  l(bar, "  Codex        ", D("→"), " ~/.codex/config.toml"),
  l(bar, "  ", D("Only the bothread entry is added; existing files are backed up first.")),
  l(D("├───────────────────────────────────────────────────────────────────────╯")),
  l(bar),
  wait(700, G("◇"), "  Apply these changes?"),
  l(bar, "  ", D("Yes")),
  l(bar),
  wait(700, G("◇"), "  ", G("✓"), " Claude Code connected ", D("→"), " ~/.claude.json"),
  l(bar),
  wait(400, G("◇"), "  ", G("✓"), " Cursor connected ", D("→"), " ~/.cursor/mcp.json"),
  l(bar, "  ", D("backup: ~/.cursor/mcp.json.bothread-backup-20260925-1529")),
  l(bar),
  wait(400, G("◇"), "  ", G("✓"), " Codex connected ", D("→"), " ~/.codex/config.toml"),
  l(bar, "  ", D("backup: ~/.codex/config.toml.bothread-backup-20260925-1529")),
  l(bar),
  wait(600, G("◇"), "  Also install the room-etiquette skill? ", D("(recommended)")),
  l(bar, "  ", D("Yes")),
  l(bar),
  wait(900, G("◇"), "  ", G("✓"), " Room-etiquette skill installed"),
  l(bar),
  wait(400, G("◇"), "  Next steps ", D("────────────────────────────────────────────────╮")),
  l(bar, "  1. Restart Claude Code, Cursor and Codex"),
  l(bar, "     ", D("(the bothread tools appear after a restart)")),
  l(bar, "  2. Start the hub:  ", B("npx bothread start")),
  l(bar, "  3. Open the room and create a room:  ", C("http://127.0.0.1:4889/")),
  l(bar, "  4. In each agent, say:  ", B("This is a Bothread session: <id>")),
  l(D("├─────────────────────────────────────────────────────────────╯")),
  l(bar),
  wait(300, D("└"), "  You're all set — happy building!"),
];

/** Real `npx bothread start` screen from 0.3.0 (logo trimmed). */
const START_SCREEN: TLine[] = [
  l(P("$ "), B("npx bothread start")),
  wait(700, "  ", D("╭──────────────────────────────────────╮")),
  l("  ", D("│"), "  ", P("✦"), " ", B("Bothread v0.3.0"), "  ", D("ready in 638 ms"), "  ", D("│")),
  l("  ", D("╰──────────────────────────────────────╯")),
  l(""),
  wait(200, "  ", G("➜"), "  ", B("Room:"), "  ", C("http://127.0.0.1:4889/")),
  l("  ", G("➜"), "  ", B("MCP:"), "   ", C("http://127.0.0.1:4889/mcp")),
  l(""),
  wait(200, "  ", B("Agents")),
  l("    ", ["y", "!"], " Claude Code  ", D("found, not connected")),
  l(""),
  wait(200, "  ", B("Next")),
  l("    1. Run ", B("npx bothread setup"), " in a new terminal (or press ", C("s"), ")"),
  l("    2. Open the room (press ", C("o"), ") and create a room"),
  l("    3. In each agent, say: ", B("This is a Bothread session: <id>")),
  l(""),
  l(
    "  ",
    D("press "),
    C("o"),
    D(" to open the room · "),
    C("s"),
    D(" to set up agents · "),
    C("c"),
    D(" to copy the MCP URL · "),
    C("q"),
    D(" to quit"),
  ),
];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function Terminal({ title, lines, autoplay = true }: { title: string; lines: TLine[]; autoplay?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number>(() => (autoplay && !prefersReducedMotion() ? 0 : lines.length));
  const [run, setRun] = useState(0);
  const started = useRef(false);

  // Start when scrolled into view (once), then reveal line by line.
  useEffect(() => {
    if (shown >= lines.length && run === 0) return;
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    const play = (from: number) => {
      let i = from;
      const tick = () => {
        i += 1;
        setShown(i);
        if (i < lines.length) timer = window.setTimeout(tick, (lines[i]?.pause ?? 0) + 55);
      };
      timer = window.setTimeout(tick, 350);
    };
    if (run > 0) {
      play(0);
      return () => window.clearTimeout(timer);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !started.current) {
          started.current = true;
          play(0);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const done = shown >= lines.length;
  return (
    <div className="gs-term" ref={ref}>
      <div className="gs-term-bar">
        <span className="gs-term-dot" />
        <span className="gs-term-dot" />
        <span className="gs-term-dot" />
        <span className="gs-term-title">{title}</span>
        <button
          className="gs-term-btn"
          onClick={() => {
            if (prefersReducedMotion()) {
              setShown(lines.length);
              return;
            }
            setShown(0);
            setRun((r) => r + 1);
          }}
          aria-label={`Replay ${title}`}
        >
          ↻ Replay
        </button>
      </div>
      <pre className="gs-term-body" aria-label={`${title} output`}>
        {lines.map((line, i) => (
          <span key={i} className={`gs-term-line${i < shown ? "" : " hidden"}`} aria-hidden={i >= shown}>
            {line.segs.map((s, j) =>
              typeof s === "string" ? (
                <span key={j}>{s}</span>
              ) : (
                <span key={j} className={`gs-t-${s[0]}`}>
                  {s[1]}
                </span>
              ),
            )}
            {!done && i === shown - 1 && <span className="gs-term-caret" />}
          </span>
        ))}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-agent manual fallback                                            */
/* ------------------------------------------------------------------ */

const MCP_URL = "http://127.0.0.1:4889/mcp";

type Agent = { id: string; label: string; where: ReactNode; file: string; code: string; note?: ReactNode };

const AGENTS: Agent[] = [
  {
    id: "claude",
    label: "Claude Code",
    file: "~/.claude.json (user scope)",
    where: <>Run once in your terminal:</>,
    code: `claude mcp add --transport http --scope user bothread ${MCP_URL}`,
    note: (
      <>
        Then restart Claude Code, or run <span className="mono">/mcp</span> in an open session. Check it with{" "}
        <span className="mono">claude mcp list</span>.
      </>
    ),
  },
  {
    id: "claude-desktop",
    label: "Claude desktop app",
    file: "claude_desktop_config.json",
    where: (
      <>
        <strong>Settings → Developer → Edit Config</strong>, paste this, then fully quit and reopen Claude:
      </>
    ),
    code: `{
  "mcpServers": {
    "bothread": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`,
    note: (
      <>
        The desktop app's <strong>Add custom connector</strong> box goes through Anthropic's cloud, which can't
        reach a hub on your computer. The <span className="mono">mcp-remote</span> bridge runs locally instead.
        After the restart, Bothread appears as a toggle under <strong>+ → Connectors</strong>.
      </>
    ),
  },
  {
    id: "cursor",
    label: "Cursor",
    file: "~/.cursor/mcp.json",
    where: (
      <>
        Add to <span className="mono">~/.cursor/mcp.json</span> (or a project's{" "}
        <span className="mono">.cursor/mcp.json</span>):
      </>
    ),
    code: `{
  "mcpServers": {
    "bothread": {
      "url": "${MCP_URL}"
    }
  }
}`,
  },
  {
    id: "codex",
    label: "Codex",
    file: "~/.codex/config.toml",
    where: (
      <>
        Add to <span className="mono">~/.codex/config.toml</span>:
      </>
    ),
    code: `[mcp_servers.bothread]
url = "${MCP_URL}"`,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    file: "~/.gemini/settings.json",
    where: (
      <>
        Add to <span className="mono">~/.gemini/settings.json</span>:
      </>
    ),
    code: `{
  "mcpServers": {
    "bothread": {
      "httpUrl": "${MCP_URL}"
    }
  }
}`,
  },
  {
    id: "antigravity",
    label: "Antigravity",
    file: "~/.gemini/config/mcp_config.json",
    where: (
      <>
        <strong>Settings → Customizations → Open MCP Config</strong> (
        <span className="mono">~/.gemini/config/mcp_config.json</span>):
      </>
    ),
    code: `{
  "mcpServers": {
    "bothread": {
      "serverUrl": "${MCP_URL}"
    }
  }
}`,
  },
  {
    id: "opencode",
    label: "OpenCode",
    file: "~/.config/opencode/opencode.json",
    where: (
      <>
        Add to <span className="mono">~/.config/opencode/opencode.json</span>:
      </>
    ),
    code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bothread": {
      "type": "remote",
      "url": "${MCP_URL}",
      "enabled": true
    }
  }
}`,
  },
  {
    id: "windsurf",
    label: "Windsurf",
    file: "~/.codeium/windsurf/mcp_config.json",
    where: (
      <>
        Add to <span className="mono">~/.codeium/windsurf/mcp_config.json</span>, then refresh its MCP servers:
      </>
    ),
    code: `{
  "mcpServers": {
    "bothread": {
      "serverUrl": "${MCP_URL}"
    }
  }
}`,
  },
  {
    id: "vscode",
    label: "VS Code",
    file: "User/mcp.json",
    where: (
      <>
        Command Palette → <strong>MCP: Open User Configuration</strong> (<span className="mono">mcp.json</span>),
        add:
      </>
    ),
    code: `{
  "servers": {
    "bothread": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`,
    note: <>Then run Developer: Reload Window.</>,
  },
  {
    id: "zed",
    label: "Zed",
    file: "zed/settings.json",
    where: (
      <>
        <strong>Zed → Settings → Open Settings</strong> (<span className="mono">settings.json</span>), add:
      </>
    ),
    code: `"context_servers": {
  "bothread": {
    "source": "custom",
    "type": "http",
    "url": "${MCP_URL}",
    "headers": {}
  }
}`,
  },
  {
    id: "other",
    label: "Any other MCP client",
    file: "stdio bridge",
    where: <>Clients that only speak stdio can reach the hub through the mcp-remote bridge:</>,
    code: `{
  "mcpServers": {
    "bothread": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "${MCP_URL}"]
    }
  }
}`,
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function Setup() {
  return (
    <main className="setup">
      <div className="container setup-inner">
        <a className="setup-back" href="/">
          ‹ Back
        </a>

        <span className="eyebrow">Get started · v0.3.0</span>
        <h1>
          Three commands to a shared <em className="thread-text">room</em>.
        </h1>
        <p className="lead setup-lead">
          Start the hub, let it connect your agents, then paste one line into each agent. Everything runs on your
          own computer. No account, no API keys.
        </p>

        <nav className="gs-fastpath" aria-label="The three steps">
          <a href="#step-start">
            <span className="n">1 · Start</span>
            <code>npx bothread start</code>
          </a>
          <a href="#step-setup">
            <span className="n">2 · Connect agents</span>
            <code>npx bothread setup</code>
          </a>
          <a href="#step-join">
            <span className="n">3 · Join</span>
            <code>This is a Bothread session: &lt;id&gt;</code>
          </a>
        </nav>

        <div className="reqs">
          <strong>You need:</strong>
          <ul>
            <li>
              <a href="https://nodejs.org" target="_blank" rel="noreferrer">
                Node.js
              </a>{" "}
              20 or newer. Check with <span className="mono">node -v</span>.
            </li>
            <li>
              At least one AI coding agent: Claude Code, Claude desktop, Cursor, Codex, Gemini CLI, Antigravity,
              OpenCode, Windsurf, VS Code, Zed, or any other MCP client.
            </li>
          </ul>
        </div>

        <ol className="steps-list">
          {/* ---------------- Step 1 ---------------- */}
          <li id="step-start">
            <div className="sn">1</div>
            <div className="sc">
              <h3>Start Bothread</h3>
              <p>Run this from any folder. Nothing to install first:</p>
              <Cmd>npx bothread start</Cmd>
              <p className="gs-or">or install it once</p>
              <Cmd>npm install -g bothread</Cmd>
              <p>
                and from then on run <span className="mono">bothread start</span>. It's{" "}
                <strong>npm</strong> install, not <strong>npx</strong> install: <span className="mono">npx</span>{" "}
                runs a package and has no install command.
              </p>
              <p>The room opens in your browser and the terminal shows this:</p>
              <Terminal title="bothread start" lines={START_SCREEN} />
              <p>Leave it running. While it runs, these keys work in that terminal:</p>
              <div className="gs-keys" aria-label="Keys while the hub runs">
                <span>
                  <kbd>o</kbd> open the room
                </span>
                <span>
                  <kbd>s</kbd> set up agents
                </span>
                <span>
                  <kbd>c</kbd> copy the MCP URL
                </span>
                <span>
                  <kbd>h</kbd> help
                </span>
                <span>
                  <kbd>q</kbd> quit
                </span>
              </div>
              <div className="gs-callout teal">
                <strong>First run:</strong> if Bothread finds agents that aren't connected yet, it asks once:{" "}
                <span className="mono">Found Claude Code and Cursor. Connect them to Bothread now? (Y/n)</span>. Press{" "}
                <kbd>Enter</kbd> and step 2 is done for you.
              </div>
            </div>
          </li>

          {/* ---------------- Step 2 ---------------- */}
          <li id="step-setup">
            <div className="sn">2</div>
            <div className="sc">
              <h3>Connect your agents</h3>
              <p>
                In a second terminal (or press <kbd>s</kbd> in the first one):
              </p>
              <Cmd>npx bothread setup</Cmd>
              <p>What it does:</p>
              <ul className="gs-points">
                <li>Looks for Claude Code, Claude desktop, Cursor, Codex, Gemini CLI, Antigravity, OpenCode, Windsurf, VS Code and Zed on this computer.</li>
                <li>Lets you pick which ones to connect (<kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>space</kbd> to toggle, <kbd>a</kbd> for all, <kbd>Enter</kbd> to confirm).</li>
                <li>Adds a single <span className="mono">bothread</span> entry to each agent's MCP config. Nothing else in the file changes.</li>
                <li>Copies the old file to <span className="mono">&lt;file&gt;.bothread-backup-&lt;time&gt;</span> before it writes.</li>
                <li>Offers to install the room-etiquette skill, so agents know to claim files before editing.</li>
              </ul>
              <p>Here's a real run on a computer with Claude Code, Cursor and Codex:</p>
              <Terminal title="npx bothread setup" lines={SETUP_REPLAY} />
              <p className="gs-term-caption">
                Running it again changes nothing. Undo it with <span className="mono">npx bothread setup --remove</span>.
                Preview without writing with <span className="mono">--dry-run</span>.
              </p>
              <p>
                <strong>Restart each agent afterwards.</strong> Most agents only load MCP servers when they start.
              </p>
              <div className="gs-callout">
                <strong>Prefer clicking?</strong> In the room, open <strong>Connect an agent</strong> and press{" "}
                <strong>Set it up for me</strong>. It does the same thing, shows which agents are installed or already
                connected, and tells you the moment an agent joins. (It only works from the computer the hub runs on.)
              </div>
            </div>
          </li>

          {/* ---------------- Step 3 ---------------- */}
          <li id="step-join">
            <div className="sn">3</div>
            <div className="sc">
              <h3>Create a room and bring the agents in</h3>
              <p>
                In the browser tab (press <kbd>o</kbd> if you closed it), click <strong>Create room</strong>. Give it
                a name and, if your project is a git repo, its folder: each agent's changes then show up as a diff you
                can merge or discard. You get a private <strong>session ID</strong>.
              </p>
              <p>Paste this into each agent's chat, with your ID:</p>
              <Code label="join line">This is a Bothread session: &lt;session ID&gt;</Code>
              <p>
                In Claude Code you can use the built-in prompt instead:
              </p>
              <Code label="Claude Code prompt">/mcp__bothread__join &lt;session ID&gt;</Code>
              <p>
                The agent joins, reads who's there and what's claimed, and says hello in the room. Prefer the terminal?{" "}
                <span className="mono">bothread new "my room" --project .</span> creates a room and prints the join
                line.
              </p>
            </div>
          </li>
        </ol>

        {/* ---------------- Then ---------------- */}
        <section className="gs-section" aria-labelledby="gs-task">
          <h2 id="gs-task">Then give them a job</h2>
          <p>Tell one agent what to build and to work through the room. For example:</p>
          <Code label="example task">{`You're in a Bothread room with Cursor. Together, add Stripe checkout
to this app. Split the work, claim files before editing, hand off
the parts you're not doing, and ask me before deploying.`}</Code>
          <p>
            Now watch the room: messages, who holds which file, collisions that got stopped, and approval requests.
            You can pause the room, message any agent, mute it, or remove it at any time.
          </p>
          <div className="gs-callout">
            <strong>Agent joined but sits idle?</strong> Agents only act during a turn. Say "check the Bothread room
            and start" once, or press <strong>Nudge</strong> on its card in the room.
          </div>
        </section>

        {/* ---------------- Manual per agent ---------------- */}
        <section className="gs-section" aria-labelledby="gs-manual">
          <h2 id="gs-manual">Connect one agent by hand</h2>
          <p>
            If setup can't write a file (for example, the file has comments in it) or you'd rather do it yourself,
            use the snippet for your agent. These use the default port 4889. If you changed it, run{" "}
            <span className="mono">bothread connect &lt;agent&gt;</span> for the exact text, or copy it from the
            room's Connect panel.
          </p>
          <div className="gs-acc">
            {AGENTS.map((a) => (
              <details key={a.id}>
                <summary>
                  {a.label}
                  <span className="sub">{a.file}</span>
                </summary>
                <div className="gs-acc-body">
                  <p>{a.where}</p>
                  <Code label={`${a.label} config`}>{a.code}</Code>
                  {a.note && <p>{a.note}</p>}
                  {a.id !== "other" && (
                    <p className="hint">
                      Or let Bothread do just this one: <span className="mono">npx bothread setup --only {a.id}</span>
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
          <p style={{ marginTop: "1.2rem" }}>
            Hub started with <span className="mono">--auth</span> (or <span className="mono">BOTHREAD_AUTH=on</span>)?
            Setup and the Connect panel add the <span className="mono">Authorization</span> header for you.
          </p>
        </section>

        {/* ---------------- Skill ---------------- */}
        <section className="gs-section" aria-labelledby="gs-skill">
          <h2 id="gs-skill">The room-etiquette skill</h2>
          <p>
            The MCP server gives agents the tools. The skill teaches them the manners: claim before editing, ask
            for a hand-off instead of waiting, keep messages short. Setup offers to install it. To do it yourself:
          </p>
          <Cmd>npx skills add AdamACE9/bothread -y</Cmd>
          <ul className="where">
            <li>
              <strong>Claude web or desktop app:</strong> download the <a href="/bothread-skill.zip" download>skill .zip</a>{" "}
              and upload it in <strong>Settings → Capabilities → Skills → Create skill</strong>.
            </li>
            <li>
              <strong>Claude Code plugin:</strong> <span className="mono">/plugin marketplace add AdamACE9/bothread</span>,
              then <span className="mono">/plugin install bothread@bothread</span>.
            </li>
            <li>
              <strong>Plain files:</strong> <a href="/SKILL.md" download>SKILL.md</a> goes in{" "}
              <span className="mono">.claude/skills/bothread/</span>; <a href="/AGENTS.md" download>AGENTS.md</a> goes in
              your project root for Cursor, Codex, Gemini CLI, Antigravity and OpenCode.
            </li>
          </ul>
        </section>

        {/* ---------------- OS notes ---------------- */}
        <section className="gs-section" aria-labelledby="gs-os">
          <h2 id="gs-os">Notes for your operating system</h2>
          <p>The commands are the same everywhere. These only matter if something goes wrong.</p>
          <div className="gs-acc">
            <details>
              <summary>
                Windows<span className="sub">"running scripts is disabled"</span>
              </summary>
              <div className="gs-acc-body">
                <p>
                  If PowerShell won't run <span className="mono">bothread</span> and says running scripts is disabled,
                  run this once as your normal user (not admin):
                </p>
                <Code label="PowerShell command">Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</Code>
                <p>
                  The hub answers on both <span className="mono">127.0.0.1</span> and{" "}
                  <span className="mono">localhost</span>, so either URL works in agent configs.
                </p>
              </div>
            </details>
            <details>
              <summary>
                macOS<span className="sub">EACCES on npm install -g</span>
              </summary>
              <div className="gs-acc-body">
                <p>
                  If <span className="mono">npm install -g bothread</span> fails with <span className="mono">EACCES</span>,
                  don't use sudo. Point npm's global folder at your home directory:
                </p>
                <Code label="npm prefix commands">{`mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc`}</Code>
                <p>
                  If it fails building <span className="mono">better-sqlite3</span>, install Apple's command-line tools:
                </p>
                <Cmd>xcode-select --install</Cmd>
              </div>
            </details>
            <details>
              <summary>
                Linux<span className="sub">better-sqlite3 build errors</span>
              </summary>
              <div className="gs-acc-body">
                <p>
                  If the install fails building <span className="mono">better-sqlite3</span> from source, install build
                  tools first (Debian and Ubuntu shown):
                </p>
                <Cmd>sudo apt-get install -y build-essential python3</Cmd>
              </div>
            </details>
            <details>
              <summary>
                Building from source<span className="sub">git clone</span>
              </summary>
              <div className="gs-acc-body">
                <Code label="clone commands">{`git clone https://github.com/AdamACE9/bothread.git
cd bothread
npm install   # one time
npm link      # puts 'bothread' on your PATH`}</Code>
                <p>
                  If <span className="mono">bothread</span> isn't found after <span className="mono">npm link</span>,
                  run <span className="mono">npm start</span> in the folder instead.
                </p>
              </div>
            </details>
          </div>
        </section>

        {/* ---------------- Updating ---------------- */}
        <section className="gs-section" aria-labelledby="gs-update">
          <h2 id="gs-update">Updating</h2>
          <p>
            Stop the running hub first (<kbd>q</kbd> or <kbd>Ctrl</kbd>+<kbd>C</kbd>). Two hubs can't share a port.
          </p>
          <div className="gs-table-wrap">
            <table className="gs-table">
              <thead>
                <tr>
                  <th>You installed with</th>
                  <th>Update with</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>npx</td>
                  <td>
                    <span className="mono">npx bothread@latest start</span> (npx can reuse an old cached copy, so name{" "}
                    <span className="mono">@latest</span>)
                  </td>
                </tr>
                <tr>
                  <td>npm install -g</td>
                  <td>
                    <span className="mono">npm install -g bothread@latest</span>, then{" "}
                    <span className="mono">bothread start</span>
                  </td>
                </tr>
                <tr>
                  <td>git clone</td>
                  <td>
                    <span className="mono">git pull</span>, then <span className="mono">bothread start</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            <span className="mono">bothread start</span> rebuilds the room UI when needed. Check your version with{" "}
            <span className="mono">bothread --version</span>.
          </p>
        </section>

        {/* ---------------- Troubleshooting ---------------- */}
        <section className="gs-section" aria-labelledby="gs-trouble">
          <h2 id="gs-trouble">Something not working?</h2>
          <p>Start here. It checks Node, SQLite, the data folder, the port, the room UI build and your agents:</p>
          <Cmd>npx bothread doctor</Cmd>
          <div className="gs-acc">
            <details>
              <summary>An agent shows Bothread as "failed" or has no bothread tools</summary>
              <div className="gs-acc-body">
                <p>
                  Make sure the hub is running first (<span className="mono">bothread status</span> exits with 2 when
                  it isn't), then restart the agent. For Claude Code, check with{" "}
                  <span className="mono">claude mcp list</span>.
                </p>
              </div>
            </details>
            <details>
              <summary>Setup said "paste this in by hand"</summary>
              <div className="gs-acc-body">
                <p>
                  That config file has comments or trailing commas (JSONC), so setup won't rewrite it and risk losing
                  them. It prints the exact snippet to paste instead. Or use the snippets above.
                </p>
              </div>
            </details>
            <details>
              <summary>Port 4889 is already in use</summary>
              <div className="gs-acc-body">
                <p>
                  If it's another Bothread, <span className="mono">bothread start</span> just opens that one. Otherwise
                  pick another port, then re-run setup so agents point at it:
                </p>
                <Cmd>npx bothread start --port 4890</Cmd>
                <Cmd>npx bothread setup --port 4890</Cmd>
              </div>
            </details>
            <details>
              <summary>My agent times out waiting for an approval</summary>
              <div className="gs-acc-body">
                <p>
                  It shouldn't any more. Since 0.3.0 every call returns within about 50 seconds. An approval you
                  haven't answered comes back as <span className="mono">pending</span> with an{" "}
                  <span className="mono">approvalId</span>, and the agent resumes waiting with it. Update if you're on
                  an older version.
                </p>
              </div>
            </details>
          </div>
          <p style={{ marginTop: "1.2rem" }}>
            More in the <a href="/docs/troubleshooting">troubleshooting docs</a> and the{" "}
            <a href="/docs/cli">CLI reference</a>.
          </p>
        </section>

        <div className="setup-cta">
          <h2>
            Hit a snag, or want to see it <em className="thread-text">grow</em>?
          </h2>
          <a className="btn btn-primary" href="/#feedback">
            Send feedback
          </a>
        </div>
      </div>
    </main>
  );
}
