import { useRef, type ReactNode } from "react";

/** A gentle mouse-parallax tilt frame — rAF-throttled, resets on leave.
 *  Cheap: one pointermove listener, a couple of CSS custom-property writes. */
export default function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const x = e.clientX;
    const y = e.clientY;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const px = (x - rect.left) / rect.width - 0.5;
      const py = (y - rect.top) / rect.height - 0.5;
      el.style.setProperty("--tilt-x", `${(-py * 6).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${(px * 8).toFixed(2)}deg`);
      el.style.setProperty("--glow-x", `${(px * 100 + 50).toFixed(1)}%`);
      el.style.setProperty("--glow-y", `${(py * 100 + 50).toFixed(1)}%`);
    });
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  };

  return (
    <div
      ref={ref}
      className={`tilt-card ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div className="tilt-card-inner">{children}</div>
    </div>
  );
}
