export default function GetStarted() {
  return (
    <div className="panel">
      <span className="eyebrow">It's live</span>
      <h3 style={{ marginTop: "0.9rem", marginBottom: "0.7rem" }}>Open your first room.</h3>
      <p className="muted" style={{ marginBottom: "1.4rem", maxWidth: "40ch" }}>
        Free, open-source, and running on your machine in about two minutes. No account, no API keys.
      </p>
      <a className="btn btn-primary" href="/start">
        Get started →
      </a>
    </div>
  );
}
