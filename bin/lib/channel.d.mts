/** Types for bin/lib/channel.mjs (imported by the TypeScript tests). */

export const CHANNEL_SERVER_NAME: string;
export const CHANNEL_PROTOCOLS: string[];

export interface ChannelEvent {
  content: string;
  meta: Record<string, string>;
}

export function channelEvent(
  room: { roomId?: string; roomName: string },
  interrupt: { seq: number; author: string; authorKind: string; importance: string; text: string; mentioned: boolean }
): ChannelEvent;

export interface Channel {
  handle(msg: unknown): void;
  pollOnce(waitMs?: number): Promise<number>;
  stop(): void;
  readonly since: Record<string, number>;
}

export function createChannel(opts: {
  agent: string;
  port: number;
  projectPath: string;
  write: (msg: any) => void;
  hubCall?: (port: number, method: string, urlPath: string, body: unknown, timeoutMs: number) => Promise<{ status: number; json: any }>;
  log?: (s: string) => void;
  version?: string;
}): Channel;

export function cmdChannel(args: { flags: Record<string, unknown> }, ctx: { CliError: unknown; version: string }): Promise<number>;
