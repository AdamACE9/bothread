import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Splits plain text into words, each its own blur-up reveal span, staggered.
 *  Used for the hero headline — cheap (word-level, not char-level DOM spam)
 *  but reads as a confident cinematic cascade rather than a flat fade-in. */
export default function SplitReveal({
  text,
  as: Tag = "span",
  startDelay = 0,
  step = 40,
  className = "",
}: {
  text: string;
  as?: "span" | "h1";
  startDelay?: number;
  step?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        }),
      { threshold: 0.2 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const words = text.split(" ");

  return (
    <Tag ref={ref as never} className={`split-reveal ${className}`}>
      {words.map((word, i) => (
        <span className="split-reveal-word" key={i}>
          <span
            className={`split-reveal-inner ${visible ? "is-visible" : ""}`}
            style={{ transitionDelay: `${startDelay + i * step}ms` } as CSSProperties}
          >
            {word}
          </span>
        </span>
      ))}
    </Tag>
  );
}
