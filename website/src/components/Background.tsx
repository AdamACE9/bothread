import { useEffect, useRef } from "react";

export default function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !ref.current) return;

    let alive = true;
    let cleanup = () => {};
    // Lazy-load Three.js only when motion is allowed — keeps it out of the initial bundle.
    import("../three/wovenBackground")
      .then(({ createWovenBackground }) => {
        if (!alive || !ref.current) return;
        try {
          cleanup = createWovenBackground(ref.current);
        } catch {
          /* WebGL unsupported — the static .bg-fallback gradient remains visible */
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
      cleanup();
    };
  }, []);

  return (
    <>
      <div className="bg-fallback" aria-hidden="true" />
      <canvas ref={ref} className="bg-canvas" aria-hidden="true" />
    </>
  );
}
