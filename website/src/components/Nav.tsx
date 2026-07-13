import { useEffect, useState } from "react";

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
          <img src="/logo.png" alt="Bothread" className="brand-logo" />
        </a>
        <nav className="nav-pill" aria-label="Primary">
          <a href="/#how">How it works</a>
          <a href="/#why">Why it’s different</a>
          <a href="/#faq">FAQ</a>
          <a href="/#waitlist">Request access</a>
        </nav>
        <a className="btn btn-primary nav-cta" href="/start">
          Get started
        </a>
      </div>
    </header>
  );
}
