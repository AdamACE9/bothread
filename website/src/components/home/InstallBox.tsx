import { useEffect, useRef, useState } from "react";

/** The primary action on the page: the one command, with a copy button. */
export default function InstallBox({ command = "npx bothread start", className = "" }: { command?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = command;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`ib ${className}`}>
      <span className="ib-prompt" aria-hidden="true">$</span>
      <code className="ib-cmd">{command}</code>
      <button type="button" className={`ib-copy ${copied ? "is-copied" : ""}`} onClick={copy} aria-label={`Copy the command ${command}`}>
        {copied ? (
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10h.3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">{copied ? "Command copied to clipboard" : ""}</span>
    </div>
  );
}
