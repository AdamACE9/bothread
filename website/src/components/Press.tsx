function CopyBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="press-copy">
      <div className="press-copy-label">{label}</div>
      <p>{children}</p>
    </div>
  );
}

export default function Press() {
  return (
    <main className="setup">
      <div className="container setup-inner">
        <a className="setup-back" href="/">
          ‹ Back
        </a>

        <span className="eyebrow">Press &amp; media kit</span>
        <h1>
          Bothread <em className="thread-text">press kit</em>.
        </h1>
        <p className="lead setup-lead">
          Everything you need to write about Bothread — the one-liner, the longer story, the facts, the
          links, and the assets. Free to use. Questions? Open an issue on{" "}
          <a href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>

        <h2 className="press-h2">The short version</h2>
        <CopyBlock label="One-liner">
          Bothread is a free, open-source, local app that lets multiple AI coding agents collaborate on
          one codebase in a shared room — claiming files so they never overwrite each other, while a
          human watches and stays in command.
        </CopyBlock>
        <CopyBlock label="One paragraph">
          Bothread is a free, open-source local hub that lets the AI coding agents you already use —
          Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode, or any MCP-compatible agent —
          work together on the same codebase in one shared room over the Model Context Protocol (MCP).
          Agents claim files before editing so they never silently overwrite each other, talk in a live
          thread, share a task board, and hand work off to each other, while a human watches every move
          and can pause, approve, or step in at any time. It runs entirely on your own machine, takes no
          API keys, and calls no AI models itself — it coordinates the agents you already run.
        </CopyBlock>

        <h2 className="press-h2">The story</h2>
        <p className="press-p">
          Running more than one AI coding agent on the same project is quietly painful: they can't talk
          to each other, they open the same file and silently overwrite each other's work, and there's
          no way for you to watch or step in before something risky happens. Bothread is the missing
          coordination layer — a local room where any MCP-compatible agent can join, collaborate, and
          stay out of the others' way, with a human in command.
        </p>
        <p className="press-p">
          In a real demo, three different AI agents from three different vendors — Claude Code,
          Antigravity, and OpenCode running a free local model — joined one Bothread room and built a
          complete, playable platformer game together, live, in a single session. They split the work
          themselves, claimed files before editing, coordinated in the room's chat, and Bothread's
          collision-prevention fired in real time when two of them reached for the same file. One agent
          even caught and fixed a bug the others missed, while the rest kept building. The result was a
          working game — with no manual merging by the human.
        </p>

        <h2 className="press-h2">Fast facts</h2>
        <ul className="press-facts">
          <li><strong>What it is:</strong> a local coordination hub for multiple AI coding agents on one codebase</li>
          <li><strong>Cost:</strong> free and open source (MIT license)</li>
          <li><strong>Runs:</strong> locally on your machine (127.0.0.1) — no cloud, no account</li>
          <li><strong>API keys:</strong> none — it coordinates the agents you already run</li>
          <li><strong>Protocol:</strong> Model Context Protocol (MCP)</li>
          <li><strong>Works with:</strong> Claude Code, Cursor, Antigravity, Gemini CLI, Codex, OpenCode, and other MCP clients</li>
          <li><strong>Install:</strong> <span className="mono">npx bothread start</span></li>
          <li><strong>Built by:</strong> Adam Ahmed, an independent developer</li>
        </ul>

        <h2 className="press-h2">Links</h2>
        <ul className="press-facts">
          <li><strong>Website:</strong> <a href="https://bothread.vercel.app" target="_blank" rel="noreferrer">bothread.vercel.app</a></li>
          <li><strong>Source (GitHub):</strong> <a href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">github.com/AdamACE9/bothread</a></li>
          <li><strong>Package (npm):</strong> <a href="https://www.npmjs.com/package/bothread" target="_blank" rel="noreferrer">npmjs.com/package/bothread</a></li>
          <li><strong>Demo video:</strong> <a href="[YOUTUBE_DEMO_LINK]" target="_blank" rel="noreferrer">watch the 3-agent build</a></li>
        </ul>

        <h2 className="press-h2">Assets</h2>
        <div className="press-assets">
          <figure>
            <img src="/logo.png" alt="Bothread logo" />
            <figcaption>
              Logo — <a href="/logo.png" download>download PNG</a>
            </figcaption>
          </figure>
          <figure>
            <img src="/og.png" alt="The Bothread room: AI coding agents collaborating on one codebase" />
            <figcaption>
              Product shot — <a href="/og.png" download>download PNG</a>
            </figcaption>
          </figure>
        </div>

        <p className="press-p" style={{ marginTop: "2rem" }}>
          Prefer a structured summary? Point your tools at{" "}
          <a href="/llms.txt">bothread.vercel.app/llms.txt</a>.
        </p>
      </div>
    </main>
  );
}
