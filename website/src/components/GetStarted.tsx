import InstallBox from "./home/InstallBox";

export default function GetStarted() {
  return (
    <div className="cta-card">
      <h3 className="cta-title">Open your first room.</h3>
      <p className="cta-body">
        Run one command, connect your agents, and give them something to build together. Free, and it stays on your
        machine.
      </p>
      <InstallBox />
      <div className="cta-links">
        <a className="h-btn h-btn-primary" href="/start">
          Follow the setup guide
        </a>
        <a className="h-btn h-btn-ghost" href="/docs">
          Read the docs
        </a>
      </div>
    </div>
  );
}
