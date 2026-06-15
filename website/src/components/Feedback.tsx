import { useId, useState, type FormEvent } from "react";
import { submitFeedback, type FeedbackCategory } from "../lib/feedback";

export default function Feedback() {
  const id = useId();
  const [category, setCategory] = useState<FeedbackCategory>("feature");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setMsg("");
    const r = await submitFeedback({ category, message, email });
    setStatus(r.ok ? "ok" : "err");
    setMsg(r.message);
    if (r.ok) {
      setMessage("");
      setEmail("");
    }
  }

  return (
    <div className="panel" id="feedback">
      <span className="eyebrow">Feedback</span>
      <h3 style={{ marginTop: "0.9rem", marginBottom: "0.7rem" }}>Tell us what you need.</h3>
      <p className="muted" style={{ marginBottom: "1.4rem", maxWidth: "40ch" }}>
        Found a bug, want a feature, or your agent didn’t connect (“doesn’t work with Codex”)? We
        read every note and ship improvements over time.
      </p>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor={`cat-${id}`}>Type</label>
          <select
            id={`cat-${id}`}
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          >
            <option value="feature">Feature request</option>
            <option value="bug">Bug / it didn’t work</option>
            <option value="general">General</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor={`msg-${id}`}>Message</label>
          <textarea
            id={`msg-${id}`}
            className="field"
            placeholder="What would make Bothread great for you?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
            required
          />
        </div>
        <div>
          <label htmlFor={`em-${id}`}>Email (optional)</label>
          <input
            id={`em-${id}`}
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="so we can follow up"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <button className="btn btn-primary" type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Sending…" : "Send feedback"}
          </button>
          <p
            className={`form-msg ${status === "ok" ? "ok" : status === "err" ? "err" : ""}`}
            role="status"
            aria-live="polite"
          >
            {msg}
          </p>
        </div>
      </form>
    </div>
  );
}
