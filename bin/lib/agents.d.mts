/** Types for bin/lib/agents.mjs (imported by the TypeScript hub). */

export const SERVER_NAME: "bothread";

export interface AgentMeta {
  id: string;
  label: string;
  /** Where the manual snippet goes (human instructions). */
  where: string;
  /** What to do after configuring it so the tools load. */
  restart: string;
}
export const AGENTS: readonly AgentMeta[];
export const AGENT_ALIASES: Readonly<Record<string, string>>;

export interface AgentOptions {
  /** The hub's MCP URL, e.g. http://127.0.0.1:4889/mcp. */
  mcpUrl?: string;
  /** Bearer token to send (only when the hub runs with auth on). */
  token?: string | null;
  /** Home directory to look in (default: BOTHREAD_AGENT_HOME, else the real one). */
  home?: string;
  platform?: NodeJS.Platform;
  /** PATH to search for agent CLIs (default: process.env.PATH). */
  pathEnv?: string;
}

export interface DetectedAgent {
  id: string;
  label: string;
  restart: string;
  /** The agent's app / config folder (or CLI) exists on this machine. */
  detected: boolean;
  /** Bothread is in its MCP config and points at this hub. */
  configured: boolean;
  /** A "bothread" entry exists at all (maybe for another URL). */
  hasEntry: boolean;
  /** Can Bothread write the config by itself? */
  canAutoSetup: boolean;
  /** "cli" = configured by running the agent's own CLI; "file" = config file edit. */
  method: "cli" | "file";
  configPath?: string;
  /** configPath for display (~/…). */
  target?: string;
  note?: string;
}

export interface SetupResult {
  id: string;
  label: string;
  ok: boolean;
  /** Something was (or, with dryRun, would be) written. */
  changed: boolean;
  action: "created" | "updated" | "unchanged" | "removed" | "manual" | "failed";
  message: string;
  target?: string;
  backup: string | null;
  /** The manual snippet, when the user has to paste it (or a dry run's preview). */
  snippet?: string;
}

export function resolveAgentId(input: string): string | null;
export function tildify(p: string, home?: string): string;
export function backupFile(file: string): string;
export function snippetFor(id: string, opts?: AgentOptions): string;
export function detectAgents(opts?: AgentOptions): DetectedAgent[];
export function setupAgent(id: string, opts: AgentOptions & { mcpUrl: string; dryRun?: boolean }): Promise<SetupResult>;
export function removeAgent(id: string, opts?: AgentOptions & { dryRun?: boolean }): Promise<SetupResult>;
