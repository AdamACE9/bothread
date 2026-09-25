/**
 * A tiny, dependency-free, clack-style prompt kit for the CLI's interactive
 * flows (`bothread setup`, the first-run question in `bothread start`).
 *
 *   ┌  Title
 *   │
 *   ◇  A finished step
 *   │  detail line
 *   │
 *   ◆  The active question
 *   └
 *
 * Interactive widgets need a TTY on both stdin and stdout; callers check
 * `ui.interactive` and fall back to non-interactive defaults otherwise.
 * Ctrl-C / Esc resolve to CANCEL (the terminal is always restored).
 */
import { colorEnabled, palette, truncate, visibleWidth } from "./term.mjs";

export const CANCEL = Symbol("bothread.cancel");
export const isCancel = (v) => v === CANCEL;

/** Split a raw-mode stdin chunk into keys (escape sequences stay whole). */
export function splitKeys(chunk) {
  return String(chunk).match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/gu) ?? [];
}

const KEY = {
  up: ["\x1b[A", "\x1bOA", "k"],
  down: ["\x1b[B", "\x1bOB", "j"],
  left: ["\x1b[D", "\x1bOD", "h"],
  right: ["\x1b[C", "\x1bOC", "l"],
  enter: ["\r", "\n"],
  cancel: ["\x03", "\x1b"],
};
const is = (key, name) => KEY[name].includes(key);

export function createUi({ input = process.stdin, output = process.stdout } = {}) {
  const tty = !!output.isTTY;
  const interactive = tty && !!input.isTTY && typeof input.setRawMode === "function";
  const c = palette(colorEnabled(output));
  const bar = c.gray("│");
  const write = (s) => output.write(s);
  const line = (s = "") => write(s + "\n");
  const showCursor = () => tty && write("\x1b[?25h");
  const hideCursor = () => tty && write("\x1b[?25l");
  let cursorHidden = false;
  const onExit = () => {
    if (cursorHidden) showCursor();
  };
  process.once("exit", onExit);

  const sym = {
    done: c.green("◇"),
    active: c.cyan("◆"),
    cancel: c.red("■"),
    warn: c.yellow("▲"),
    error: c.red("■"),
  };

  const intro = (title) => line(`${c.gray("┌")}  ${title}`);
  const outro = (msg) => {
    line(bar);
    line(`${c.gray("└")}  ${msg}`);
    line();
  };
  const cancelled = (msg = "Setup cancelled") => {
    line(bar);
    line(`${c.gray("└")}  ${c.red(msg)}`);
    line();
  };
  const detail = (lines) => {
    for (const d of lines) line(d ? `${bar}  ${d}` : bar);
  };
  /** A finished step: symbol + title, then detail lines in the gutter. */
  const step = (title, details = [], kind = "done") => {
    line(bar);
    line(`${sym[kind]}  ${title}`);
    detail(details);
  };

  /** A boxed note hanging off the gutter (clack's `note`). */
  const note = (title, lines) => {
    const width = Math.max(visibleWidth(title) + 1, ...lines.map((l) => visibleWidth(l))) + 2;
    const titleRule = c.gray("─".repeat(Math.max(1, width - visibleWidth(title) - 1)) + "╮");
    line(bar);
    line(`${sym.done}  ${title} ${titleRule}`);
    line(`${bar}${" ".repeat(width + 2)}${c.gray("│")}`);
    for (const l of lines) line(`${bar}  ${l}${" ".repeat(width - visibleWidth(l))}${c.gray("│")}`);
    line(`${bar}${" ".repeat(width + 2)}${c.gray("│")}`);
    line(c.gray(`├${"─".repeat(width + 2)}╯`));
  };

  /** A spinner line that collapses into a ◇ / ▲ / ■ line when it stops. */
  const spinner = () => {
    const frames = ["◒", "◐", "◓", "◑"];
    let timer = null;
    let msg = "";
    let i = 0;
    return {
      start(message) {
        msg = message;
        if (!tty) return;
        line(bar);
        hideCursor();
        cursorHidden = true;
        const draw = () => {
          const dots = ".".repeat(Math.floor(i / 4) % 4);
          write(`\r\x1b[2K${c.magenta(frames[i % frames.length])}  ${msg}${dots}`);
          i++;
        };
        draw();
        timer = setInterval(draw, 80);
      },
      message(message) {
        msg = message;
      },
      /** code: 0 done · 1 error · 2 warning */
      stop(message = msg, code = 0) {
        const s = code === 1 ? sym.error : code === 2 ? sym.warn : sym.done;
        if (timer) {
          clearInterval(timer);
          timer = null;
          write(`\r\x1b[2K${s}  ${message}\n`);
          showCursor();
          cursorHidden = false;
        } else {
          line(bar);
          line(`${s}  ${message}`);
        }
      },
    };
  };

  /**
   * Run one interactive widget: draw `render(state)`, feed keys to
   * `onKey(key, state)` (return { value } to finish), redraw in place.
   */
  const prompt = ({ state, render, onKey }) =>
    new Promise((resolve) => {
      let prevLines = 0;
      const draw = (phase) => {
        const cols = output.columns || 80;
        const lines = render(state, phase)
          .split("\n")
          .map((l) => truncate(l, cols - 1));
        let s = prevLines ? `\x1b[${prevLines}A\r` : "";
        s += "\x1b[J" + lines.join("\n") + "\n";
        write(s);
        prevLines = lines.length;
      };
      const wasRaw = !!input.isRaw;
      const wasPaused = input.readableFlowing !== true;
      hideCursor();
      cursorHidden = true;
      input.setRawMode(true);
      input.setEncoding?.("utf8");
      input.resume();
      const finish = (value, phase) => {
        input.off("data", onData);
        draw(phase);
        showCursor();
        cursorHidden = false;
        try {
          input.setRawMode(wasRaw);
        } catch {
          /* terminal already gone */
        }
        if (wasPaused) input.pause();
        resolve(value);
      };
      const onData = (chunk) => {
        for (const key of splitKeys(chunk)) {
          if (is(key, "cancel")) return finish(CANCEL, "cancel");
          const r = onKey(key, state);
          if (r && "value" in r) return finish(r.value, "submit");
        }
        draw("active");
      };
      input.on("data", onData);
      draw("active");
    });

  /** Pick any number of options. → selected values, or CANCEL. */
  const multiselect = ({ message, options, initialValues = [], hint = true }) =>
    prompt({
      state: { cursor: 0, selected: new Set(initialValues), error: "" },
      onKey(key, st) {
        st.error = "";
        if (is(key, "up")) st.cursor = (st.cursor - 1 + options.length) % options.length;
        else if (is(key, "down")) st.cursor = (st.cursor + 1) % options.length;
        else if (key === " ") {
          const v = options[st.cursor].value;
          if (st.selected.has(v)) st.selected.delete(v);
          else st.selected.add(v);
        } else if (key === "a" || key === "A") {
          const all = options.every((o) => st.selected.has(o.value));
          st.selected = new Set(all ? [] : options.map((o) => o.value));
        } else if (is(key, "enter")) return { value: options.filter((o) => st.selected.has(o.value)).map((o) => o.value) };
        return null;
      },
      render(st, phase) {
        const chosen = options.filter((o) => st.selected.has(o.value)).map((o) => o.label);
        if (phase === "submit") return `${bar}\n${sym.done}  ${message}\n${bar}  ${c.dim(chosen.join(", ") || "none")}`;
        if (phase === "cancel") return `${bar}\n${sym.cancel}  ${message}\n${bar}  ${c.strike(c.dim(chosen.join(", ") || "none"))}`;
        const labelW = Math.max(...options.map((o) => visibleWidth(o.label)));
        const rows = options.map((o, i) => {
          const on = st.selected.has(o.value);
          const active = i === st.cursor;
          const box = on ? c.green("◼") : active ? c.cyan("◻") : c.dim("◻");
          const label = active ? c.cyan(o.label) : on ? o.label : c.dim(o.label);
          const pad = " ".repeat(labelW - visibleWidth(o.label));
          const h = o.hint && (hint || active) ? `  ${c.dim(o.hint)}` : "";
          return `${c.cyan("│")}  ${box} ${label}${pad}${h}`;
        });
        const keys = c.dim("↑/↓ move · space select · a all · enter confirm");
        return [`${bar}`, `${sym.active}  ${message}`, ...rows, `${c.cyan("└")}  ${keys}`].join("\n");
      },
    });

  /** Yes / No, arrow-toggled. → boolean, or CANCEL. */
  const confirm = ({ message, initial = true, yes = "Yes", no = "No" }) =>
    prompt({
      state: { value: initial },
      onKey(key, st) {
        if (is(key, "left") || is(key, "right") || key === "\t") st.value = !st.value;
        else if (key === "y" || key === "Y") return { value: (st.value = true) };
        else if (key === "n" || key === "N") return { value: (st.value = false) };
        else if (is(key, "enter")) return { value: st.value };
        return null;
      },
      render(st, phase) {
        if (phase === "submit") return `${bar}\n${sym.done}  ${message}\n${bar}  ${c.dim(st.value ? yes : no)}`;
        if (phase === "cancel") return `${bar}\n${sym.cancel}  ${message}\n${bar}  ${c.strike(c.dim(st.value ? yes : no))}`;
        const opt = (on, label) => (on ? `${c.green("●")} ${label}` : c.dim(`○ ${label}`));
        return `${bar}\n${sym.active}  ${message}\n${c.cyan("│")}  ${opt(st.value, yes)} ${c.dim("/")} ${opt(!st.value, no)}\n${c.cyan("└")}`;
      },
    });

  /** A single-line "(Y/n)" question. → boolean, or CANCEL. */
  const yesNo = (question, initial = true) =>
    prompt({
      state: { answer: initial },
      onKey(key, st) {
        if (key === "y" || key === "Y") st.answer = true;
        else if (key === "n" || key === "N") st.answer = false;
        else if (!is(key, "enter")) return null;
        return { value: st.answer };
      },
      render(st, phase) {
        const q = `${c.bold(question)} ${c.dim(initial ? "(Y/n)" : "(y/N)")}`;
        if (phase === "active") return `  ${c.accent("?")} ${q}`;
        if (phase === "cancel") return `  ${c.red("✗")} ${q} ${c.red("cancelled")}`;
        return `  ${c.green("✓")} ${q} ${c.dim(st.answer ? "Yes" : "No")}`;
      },
    });

  return { c, tty, interactive, bar, line, intro, outro, cancelled, step, detail, note, spinner, multiselect, confirm, yesNo };
}
