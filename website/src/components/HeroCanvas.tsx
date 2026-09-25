import { useEffect, useRef, useState } from "react";
import SceneFallback from "./home/SceneFallback";

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The hero's 3D room. three.js and the scene are fetched with a dynamic
 * import, so none of it lands in the initial bundle. Until the first frame is
 * drawn (or if WebGL is unavailable) the static SVG version shows instead.
 * The render loop only runs while the scene is on screen and the tab is visible.
 */
export default function HeroCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!hasWebGL()) {
      setFailed(true);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    let scene: { setRunning(on: boolean): void; dispose(): void } | null = null;
    let onScreen = false;

    const sync = () => scene?.setRunning(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        sync();
      },
      { threshold: 0.01 }
    );
    io.observe(host);
    document.addEventListener("visibilitychange", sync);

    import("../three/roomScene")
      .then(({ createRoomScene }) => {
        if (!alive) return;
        scene = createRoomScene(host, {
          reducedMotion: reduced,
          onFirstFrame: () => alive && setReady(true),
          // If the GPU drops the context, show the static illustration instead.
          onContextLost: () => alive && setFailed(true),
        });
        sync();
      })
      .catch(() => alive && setFailed(true));

    return () => {
      alive = false;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      scene?.dispose();
      scene = null;
    };
  }, []);

  return (
    <div className={`hs ${ready && !failed ? "is-ready" : ""}`}>
      <div className="hs-fallback" aria-hidden={ready && !failed}>
        <SceneFallback />
      </div>
      {!failed && <div ref={hostRef} className="hs-host" />}
      <p className="hs-hint" aria-hidden="true">
        Drag to turn the room
      </p>
    </div>
  );
}
