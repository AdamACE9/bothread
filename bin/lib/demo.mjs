/**
 * `bothread demo`: start a hub with three simulated agents already working in a
 * demo room, or, when a hub is already running on the port, ask it to start the
 * demo (POST /api/demo) and open that room.
 *
 * The command table entry and handler live here; bin/bothread.mjs only
 * registers them and passes in its shared helpers.
 */

export const DEMO_COMMAND = {
  args: "",
  summary: "Watch 3 simulated agents work in a demo room",
  flags: ["port", "host", "db", "auth", "no-open", "json"],
  details:
    "Starts the hub (or reuses the one already running on the port) and opens a\n" +
    "room called \"Demo: platformer game\" where three simulated agents (Claude Code,\n" +
    "Cursor, Codex) split up tasks, hit a real file collision, hand a file off, leave\n" +
    "real git diffs in the Changes tab, and ask you to approve a deploy.\n" +
    "\n" +
    "They are real MCP clients driving the real hub, so everything you see is what\n" +
    "your own agents would produce. The demo's git repo lives in Bothread's data\n" +
    "folder (a temp folder with --db :memory:), never in your projects.\n" +
    "Running it again reuses the demo if it's still going, or starts a fresh one.\n" +
    "\n" +
    "Env: BOTHREAD_DEMO_SPEED=2 plays it twice as fast.",
  examples: ["bothread demo", "bothread demo --port 4890 --no-open", "bothread demo --db :memory:"],
};

/**
 * @param {{ flags: Record<string, any>, positionals: string[] }} args
 * @param {{
 *   cmdStart: (a: { flags: Record<string, any> }) => Promise<number | null>,
 *   probeHub: (port: number) => Promise<{ state: string, health?: any }>,
 *   hubRequest: (port: number, method: string, path: string, body?: unknown, timeoutMs?: number) => Promise<{ status: number, json: any }>,
 *   resolvePort: (flags: Record<string, any>) => number,
 *   openBrowser: (url: string) => void,
 *   roomUrlFor: (port: number, id: string) => string,
 *   CliError: new (message: string, exitCode?: number) => Error,
 *   c: Record<string, (s: string) => string>,
 * }} h
 */
export async function runDemo({ flags, positionals }, h) {
  if (positionals.length) {
    throw new h.CliError(`'bothread demo' takes no arguments (got '${positionals[0]}'). See: bothread help demo`);
  }
  const port = h.resolvePort(flags);
  const probe = await h.probeHub(port);

  if (probe.state === "bothread") {
    // A hub is already up: have it start (or reuse) the demo, then open the room.
    let r;
    try {
      r = await h.hubRequest(port, "POST", "/api/demo", {}, 15_000);
    } catch (err) {
      throw new h.CliError(`Lost contact with the hub on port ${port}: ${err.message}`, 2);
    }
    if (r.status === 404) {
      throw new h.CliError(
        `The hub on port ${port} is an older Bothread without demo mode.\n` +
          `Stop it (Ctrl-C in its terminal) and run 'bothread demo' again, or use another port: bothread demo --port 4890`
      );
    }
    if (r.status >= 400 || !r.json?.roomId) throw new h.CliError(`The hub couldn't start the demo: ${r.json?.error ?? `HTTP ${r.status}`}`);
    const url = h.roomUrlFor(port, r.json.roomId);
    if (flags.json) {
      process.stdout.write(JSON.stringify({ roomId: r.json.roomId, started: !!r.json.started, url }, null, 2) + "\n");
    } else {
      const c = h.c;
      console.log(`\n  ${c.green("●")} ${r.json.started ? "Demo started" : "Demo already running"} on the hub at port ${port}.`);
      console.log(`    ${c.dim("Room:")} ${c.cyan(url)}\n`);
    }
    if (!flags["no-open"] && !process.env.BOTHREAD_NO_OPEN) h.openBrowser(url);
    return 0;
  }
  if (flags.json) {
    throw new h.CliError("--json needs a running hub (it prints the demo room). Start one first: bothread start", 2);
  }

  // No hub yet: start one that begins the demo as soon as it's listening and
  // opens the browser straight into the demo room.
  process.env.BOTHREAD_DEMO = "1";
  process.env.BOTHREAD_NO_SETUP = "1";
  return h.cmdStart({ flags: { ...flags, "no-setup": true } });
}
