import ThreadMark from "./ThreadMark";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer>
      <div className="container foot-inner">
        <div>
          <a className="brand" href="#top" aria-label="Bothread — home">
            <ThreadMark size={22} />
            <span>
              Bo<b>thread</b>
            </span>
          </a>
          <p className="foot-tag" style={{ marginTop: "0.7rem" }}>
            Local-first. MCP-native. You stay in command.
          </p>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <a href="#how" className="muted">How it works</a>
          <a href="#why" className="muted">Why it’s different</a>
          <a href="#feedback" className="muted">Feedback</a>
          <span className="foot-tag">© {year} Bothread</span>
        </div>
      </div>
    </footer>
  );
}
