import { useEffect, useRef } from "react";

/** The one place on the page that gets a live, animated canvas — scoped to the
 *  hero's own box, paused off-screen (see createThreadField). */
export default function HeroCanvas({ hostRef }: { hostRef: React.RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !hostRef.current) return;
    let cleanup = () => {};
    let alive = true;
    import("../canvas/threadField").then(({ createThreadField }) => {
      if (!alive || !canvasRef.current || !hostRef.current) return;
      cleanup = createThreadField(canvasRef.current, hostRef.current);
    });
    return () => {
      alive = false;
      cleanup();
    };
  }, [hostRef]);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
