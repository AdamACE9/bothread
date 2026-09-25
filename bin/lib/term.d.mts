/** Types for bin/lib/term.mjs (imported by the TypeScript hub). */

type Style = (s: string | number) => string;
export interface Palette {
  on: boolean;
  bold: Style;
  dim: Style;
  italic: Style;
  underline: Style;
  inverse: Style;
  strike: Style;
  red: Style;
  green: Style;
  yellow: Style;
  blue: Style;
  magenta: Style;
  cyan: Style;
  gray: Style;
  accent: Style;
}

export function colorEnabled(stream: { isTTY?: boolean } | undefined): boolean;
export function palette(on: boolean): Palette;
export function hyperlinksEnabled(stream: { isTTY?: boolean } | undefined): boolean;
export function link(url: string, text?: string, on?: boolean): string;
export function stripAnsi(s: string): string;
export function visibleWidth(s: string): number;
export function truncate(s: string, width: number): string;
export function box(lines: string[], opts?: { border?: (s: string) => string; padX?: number }): string[];
export function listJoin(items: string[]): string;
