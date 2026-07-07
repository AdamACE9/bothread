/**
 * "Loom" hero background — take two.
 *
 * The old version was a fullscreen WebGL fragment shader (51 loop iterations x
 * 5-octave fbm, PER PIXEL, every frame, forever, on a `position:fixed` canvas
 * covering the entire page). It never paused when scrolled out of view. That
 * was the site's actual "laggy" bug, not a styling problem.
 *
 * This is a plain Canvas2D system, scoped to the hero element only: a handful
 * of flowing thread strands + drifting glow motes, all O(dozens) draw calls
 * per frame instead of O(width * height * 51). It pauses via IntersectionObserver
 * (hero off-screen) and visibilitychange (tab hidden), and skips the animation
 * loop entirely under prefers-reduced-motion.
 */

interface Strand {
  baseY: number; // 0..1, fraction of height
  amp: number;
  speed: number;
  phase: number;
  colorA: string;
  colorB: string;
  width: number;
}

interface Mote {
  x: number; // 0..1
  y: number; // 0..1
  vx: number;
  vy: number;
  r: number;
  hue: "copper" | "saffron" | "teal";
  twinklePhase: number;
}

const PALETTE = {
  copper: "#cf7a3c",
  saffron: "#e2a94c",
  teal: "#63ad8f",
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** A small cached radial-gradient sprite, reused via drawImage for every mote —
 *  far cheaper than re-building a gradient per particle per frame. */
function makeMoteSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function createThreadField(canvas: HTMLCanvasElement, host: HTMLElement): () => void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx2d = canvas.getContext("2d", { alpha: true });
  if (!ctx2d) return () => {};
  const ctx: CanvasRenderingContext2D = ctx2d;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = 0;
  let h = 0;

  const STRAND_COUNT = 8;
  const strands: Strand[] = Array.from({ length: STRAND_COUNT }, (_, i) => {
    const t = i / (STRAND_COUNT - 1);
    return {
      baseY: 0.16 + t * 0.72,
      amp: 14 + (i % 3) * 8,
      speed: 0.15 + (i % 4) * 0.05,
      phase: i * 1.7,
      colorA: i % 3 === 0 ? PALETTE.teal : PALETTE.copper,
      colorB: PALETTE.saffron,
      width: i % 2 === 0 ? 1.4 : 1,
    };
  });

  const MOTE_COUNT = 16;
  const moteSpriteSize = 48;
  const spriteCache = new Map<string, HTMLCanvasElement>();
  for (const hue of ["copper", "saffron", "teal"] as const) {
    spriteCache.set(hue, makeMoteSprite(PALETTE[hue], moteSpriteSize));
  }
  const motes: Mote[] = Array.from({ length: MOTE_COUNT }, (_, i) => ({
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.006,
    vy: (Math.random() - 0.5) * 0.004,
    r: 8 + Math.random() * 14,
    hue: (["copper", "saffron", "teal"] as const)[i % 3],
    twinklePhase: Math.random() * Math.PI * 2,
  }));

  const pointer = { x: 0.78, y: 0.4, target: { x: 0.78, y: 0.4 }, v: 0 };
  let lastPointer = { x: 0.78, y: 0.4 };

  // The canvas's visual box is sized purely by CSS (`.hero-canvas` is
  // `position:absolute; inset:0`) — this only sets the backing-store
  // resolution, so a bad one-off measurement can never leave the element
  // visually squished. clientWidth/clientHeight (integer, layout-box based)
  // rather than getBoundingClientRect (fractional, can read 0 mid-reflow).
  function resize() {
    const cw = host.clientWidth;
    const ch = host.clientHeight;
    if (cw < 2 || ch < 2) return; // mid-layout — next observer tick will fix it
    w = cw;
    h = ch;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  requestAnimationFrame(resize); // catch any late first-paint reflow
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  function onPointerMove(e: PointerEvent) {
    const rect = host.getBoundingClientRect();
    pointer.target.x = (e.clientX - rect.left) / Math.max(rect.width, 1);
    pointer.target.y = (e.clientY - rect.top) / Math.max(rect.height, 1);
  }
  host.addEventListener("pointermove", onPointerMove, { passive: true });

  let running = false;
  let raf = 0;
  let t0 = performance.now();

  function drawFrame(time: number) {
    const dt = Math.min(0.05, (time - t0) / 1000);
    t0 = time;

    pointer.x = lerp(pointer.x, pointer.target.x, 0.06);
    pointer.y = lerp(pointer.y, pointer.target.y, 0.06);
    const dx = pointer.x - lastPointer.x;
    const dy = pointer.y - lastPointer.y;
    pointer.v = lerp(pointer.v, Math.min(1, Math.hypot(dx, dy) * 40), 0.15);
    lastPointer = { x: pointer.x, y: pointer.y };

    ctx.clearRect(0, 0, w, h);

    // strands
    const elapsed = time / 1000;
    for (const s of strands) {
      const points: [number, number][] = [];
      const steps = 7;
      for (let i = 0; i <= steps; i++) {
        const fx = i / steps;
        const px = fx * w;
        let py = s.baseY * h + Math.sin(elapsed * s.speed + s.phase + fx * 4) * s.amp;
        // bow away from the cursor, smoothly, near the pointer's x position
        const cursorPx = pointer.x * w;
        const cursorPy = pointer.y * h;
        const dPx = px - cursorPx;
        const influence = Math.exp(-(dPx * dPx) / (2 * 180 * 180)) * (0.35 + pointer.v * 0.8);
        py += (py > cursorPy ? 1 : -1) * influence * 30;
        points.push([px, py]);
      }
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i][0] + points[i + 1][0]) / 2;
        const midY = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, s.colorA);
      grad.addColorStop(1, s.colorB);
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.width;
      ctx.globalAlpha = 0.22 + pointer.v * 0.18;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // motes
    for (const m of motes) {
      m.x += m.vx * dt * 60;
      m.y += m.vy * dt * 60;
      if (m.x < -0.05) m.x = 1.05;
      if (m.x > 1.05) m.x = -0.05;
      if (m.y < -0.05) m.y = 1.05;
      if (m.y > 1.05) m.y = -0.05;
      const twinkle = 0.5 + 0.5 * Math.sin(elapsed * 1.1 + m.twinklePhase);
      const sprite = spriteCache.get(m.hue)!;
      const size = m.r * 2;
      ctx.globalAlpha = 0.25 + twinkle * 0.35;
      ctx.drawImage(sprite, m.x * w - m.r, m.y * h - m.r, size, size);
    }
    ctx.globalAlpha = 1;

    // cursor glow halo
    const haloR = 90 + pointer.v * 60;
    const halo = ctx.createRadialGradient(
      pointer.x * w,
      pointer.y * h,
      0,
      pointer.x * w,
      pointer.y * h,
      haloR
    );
    halo.addColorStop(0, `rgba(226,169,76,${0.10 + pointer.v * 0.18})`);
    halo.addColorStop(1, "rgba(226,169,76,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    if (running) raf = requestAnimationFrame(drawFrame);
  }

  function start() {
    if (running || reduce) return;
    running = true;
    t0 = performance.now();
    raf = requestAnimationFrame(drawFrame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  if (reduce) {
    // One static, cheap frame: no loop, no listeners needed beyond resize.
    drawFrame(performance.now());
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) start();
          else stop();
        }
      },
      { threshold: 0.01 }
    );
    io.observe(host);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  return () => {
    stop();
    ro.disconnect();
    host.removeEventListener("pointermove", onPointerMove);
  };
}
