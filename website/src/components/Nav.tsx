import { useEffect, useState } from "react";
import ThreadMark from "./ThreadMark";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav ${scrolled ? "scrolled" : ""}`}>
      <div className="container nav-inner">
        <a className="brand" href="/" aria-label="Bothread — home">
          <ThreadMark />
          <span>
            Bo<b>thread</b>
          </span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="/#how">How it works</a>
          <a href="/#why">Why it’s different</a>
          <a href="/#faq">FAQ</a>
          <a href="/#waitlist">Request access</a>
          <a className="btn btn-primary nav-cta" href="/start">
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
