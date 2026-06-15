import WaitlistForm from "./WaitlistForm";

export default function Waitlist() {
  return (
    <div className="panel">
      <span className="eyebrow">Waitlist</span>
      <h3 style={{ marginTop: "0.9rem", marginBottom: "0.7rem" }}>Get early access.</h3>
      <p className="muted" style={{ marginBottom: "1.4rem", maxWidth: "40ch" }}>
        Bothread is in active development. Leave your email and we’ll send you access and build
        updates as the room comes to life.
      </p>
      <WaitlistForm source="waitlist" />
    </div>
  );
}
