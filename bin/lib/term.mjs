/**
 * Terminal styling shared by the CLI (bin/bothread.mjs) and the hub's startup
 * screen (packages/server/src/index.ts, which esbuild inlines this into).
 *
 * Zero dependencies, on purpose: the CLI must run before `npm install`.
 */

/**
 * Color only on a real terminal, never when NO_COLOR is set; FORCE_COLOR wins
 * over both (same precedence Node itself uses).
 */
export function colorEnabled(stream) {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force !== "false";
  if (process.env.NO_COLOR) return false;
  return !!stream?.isTTY && process.env.TERM !== "dumb";
}

export function palette(on) {
  const wrap = (open, close) => (s) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    on,
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    italic: wrap("3", "23"),
    underline: wrap("4", "24"),
    inverse: wrap("7", "27"),
    strike: wrap("9", "29"),
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
    blue: wrap("34", "39"),
    magenta: wrap("35", "39"),
    cyan: wrap("36", "39"),
    gray: wrap("90", "39"),
    accent: wrap("38;5;173", "39"), // Loom copper
  };
}

/**
 * Does this terminal render OSC 8 hyperlinks? Conservative allow-list (a
 * terminal that doesn't understand them can print garbage), with
 * FORCE_HYPERLINK=1/0 as the escape hatch either way.
 */
export function hyperlinksEnabled(stream) {
  const env = process.env;
  if (env.FORCE_HYPERLINK !== undefined) return env.FORCE_HYPERLINK !== "0" && env.FORCE_HYPERLINK !== "false";
  if (!stream?.isTTY || env.TERM === "dumb" || env.CI || env.NO_COLOR) return false;
  if (env.WT_SESSION || env.KITTY_WINDOW_ID || env.WEZTERM_PANE || env.GHOSTTY_RESOURCES_DIR || env.DOMTERM || env.KONSOLE_VERSION) return true;
  if (["iTerm.app", "WezTerm", "vscode", "ghostty", "Hyper", "Tabby", "rio", "cursor"].includes(env.TERM_PROGRAM ?? "")) return true;
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true;
  return ["xterm-kitty", "xterm-ghostty", "wezterm", "alacritty"].includes(env.TERM ?? "");
}

/** An OSC 8 hyperlink whose visible text is (by default) the URL itself, so it still copies as plain text. */
export function link(url, text = url, on = true) {
  return on ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}

const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (s) => String(s).replace(ANSI, "");
export const visibleWidth = (s) => [...stripAnsi(s)].length;

/** Truncate to `width` visible columns, keeping ANSI sequences intact. */
export function truncate(s, width) {
  if (visibleWidth(s) <= width) return s;
  let out = "";
  let seen = 0;
  let i = 0;
  const str = String(s);
  while (i < str.length && seen < width - 1) {
    ANSI.lastIndex = i;
    const m = str[i] === "\x1b" ? ANSI.exec(str) : null;
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const ch = String.fromCodePoint(str.codePointAt(i));
    out += ch;
    i += ch.length;
    seen++;
  }
  ANSI.lastIndex = 0;
  return out + "…\x1b[0m";
}

/** A rounded box around `lines` (already styled). Returns the box's lines. */
export function box(lines, { border = (s) => s, padX = 2 } = {}) {
  const inner = Math.max(...lines.map(visibleWidth)) + padX * 2;
  const pad = " ".repeat(padX);
  return [
    border(`╭${"─".repeat(inner)}╮`),
    ...lines.map((l) => `${border("│")}${pad}${l}${" ".repeat(inner - padX * 2 - visibleWidth(l))}${pad}${border("│")}`),
    border(`╰${"─".repeat(inner)}╯`),
  ];
}

/** "A", "A and B", "A, B and C". */
export function listJoin(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
