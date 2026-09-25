import "../styles/home.css";
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="hf">
      <div className="hf-inner">
        <div className="hf-brand">
          <a href="/" aria-label="Bothread home">
            <img src="/logo.png" alt="" width="131" height="26" />
          </a>
          <p>Free, open-source coordination for the AI coding agents you already use. Runs on your machine.</p>
        </div>
        <nav className="hf-cols" aria-label="Footer">
          <div>
            <h2>Product</h2>
            <a href="/#how">How it works</a>
            <a href="/#features">Features</a>
            <a href="/#agents">For agents</a>
            <a href="/compare">Compare</a>
          </div>
          <div>
            <h2>Use it</h2>
            <a href="/start">Setup guide</a>
            <a href="/docs">Docs</a>
            <a href="/#faq">FAQ</a>
            <a href="/#feedback">Send feedback</a>
          </div>
          <div>
            <h2>Project</h2>
            <a href="https://github.com/AdamACE9/bothread" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://www.npmjs.com/package/bothread" target="_blank" rel="noreferrer">npm</a>
            <a href="/press">Press kit</a>
          </div>
        </nav>
      </div>
      <div className="hf-base">
        <span>© {year} Bothread. MIT licensed.</span>
        <span>Not affiliated with the embroidery brand Brothread.</span>
      </div>
    </footer>
  );
}
