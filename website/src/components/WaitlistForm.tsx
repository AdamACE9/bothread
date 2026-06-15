import { useId, useState, type FormEvent } from "react";
import { submitWaitlist, type WaitlistSource } from "../lib/waitlist";

export default function WaitlistForm({ source }: { source: WaitlistSource }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setMsg("");
    const r = await submitWaitlist(email, source);
    setStatus(r.ok ? "ok" : "err");
    setMsg(r.message);
    if (r.ok) setEmail("");
  }

  return (
    <form className="hero-form" onSubmit={onSubmit} noValidate>
      <input
        id={`wl-${id}`}
        className="field"
        type="email"
        inputMode="email"
        autoComplete="email"
        aria-label="Email address"
        aria-describedby={`wlmsg-${id}`}
        placeholder="you@studio.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button className="btn btn-primary" type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Joining…" : "Request access"}
      </button>
      <p
        id={`wlmsg-${id}`}
        className={`form-msg ${status === "ok" ? "ok" : status === "err" ? "err" : ""}`}
        role="status"
        aria-live="polite"
      >
        {msg}
      </p>
    </form>
  );
}
