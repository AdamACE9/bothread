import { useEffect, useState } from "react";
import "../styles/home.css";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#agents", label: "For agents" },
  { href: "/docs", label: "Docs" },
];

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
      <path d="M8 .9l2.1 4.4 4.8.6-3.5 3.3.9 4.8L8 11.7 3.7 14l.9-4.8L1.1 5.9l4.8-.6L8 .9z" />
    </svg>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth > 900 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className={`hn ${scrolled || open ? "is-scrolled" : ""} ${open ? "is-open" : ""}`}>
      <div className="hn-inner">
        <a className="hn-brand" href="/" aria-label="Bothread home">
          <img src="/logo.png" alt="" width="151" height="30" className="hn-logo" />
        </a>
        <nav className="hn-links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          <a className="hn-gh" href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">
            <GitHubIcon />
            GitHub
            <span className="hn-star">
              <StarIcon />
              Star
            </span>
          </a>
        </nav>
        <a className="hn-cta" href="/start">
          Get started
        </a>
        <button
          type="button"
          className="hn-toggle"
          aria-expanded={open}
          aria-controls="hn-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
      </div>
      <div id="hn-menu" className="hn-menu" hidden={!open}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <a href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">
          <GitHubIcon /> Star on GitHub
        </a>
        <a className="hn-cta hn-cta-block" href="/start" onClick={() => setOpen(false)}>
          Get started
        </a>
      </div>
    </header>
  );
}
