/**
 * The hero's 3D "room": a glowing hub, six agent nodes on tilted orbits, a
 * curved thread from each agent to the hub with messages travelling along it,
 * and a few file cards that agents claim (and sometimes collide over).
 *
 * Plain three.js, loaded lazily by HeroScene. Kept deliberately light:
 * ~2k triangles, one draw per object, additive sprites instead of
 * post-processing. The caller owns visibility (IntersectionObserver, tab
 * visibility) and calls setRunning(); this module owns everything it creates
 * and releases all of it in dispose().
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  AmbientLight,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
  DirectionalLight,
} from "three";

export type RoomScene = {
  setRunning(on: boolean): void;
  dispose(): void;
};

type Agent = { name: string; color: string };

const AGENTS: Agent[] = [
  { name: "Claude Code", color: "#e3aa70" },
  { name: "Cursor", color: "#92b9da" },
  { name: "Gemini CLI", color: "#a2c483" },
  { name: "Codex", color: "#c99fd8" },
  { name: "OpenCode", color: "#6fcab9" },
  { name: "Antigravity", color: "#e7c46a" },
];

const FILES = ["auth.ts", "schema.sql", "App.tsx", "api/routes.ts"];

const COPPER = new Color("#d27d3e");
const SAFFRON = new Color("#e5ad50");
const CLAY = new Color("#e0553d");
const PARCHMENT = new Color("#efe7d6");

const THREAD_SEGS = 40;
const PARTICLES_PER_THREAD = 3;

const easeOutBack = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function glowTexture(): Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.14)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function ringTexture(): Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createRoomScene(
  host: HTMLElement,
  opts: { reducedMotion: boolean; onFirstFrame?: () => void; onContextLost?: () => void }
): RoomScene {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = "hs-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const onLost = (e: Event) => {
    e.preventDefault();
    running = false;
    cancelAnimationFrame(raf);
    opts.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const labelLayer = document.createElement("div");
  labelLayer.className = "hs-labels";
  labelLayer.setAttribute("aria-hidden", "true");
  host.appendChild(labelLayer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 1.6, 14.8);
  camera.lookAt(0, 0, 0);

  const root = new Group();
  scene.add(root);

  scene.add(new AmbientLight(0xffe6c8, 0.45));
  const key = new DirectionalLight(0xffe2bd, 1.5);
  key.position.set(4, 6, 8);
  scene.add(key);
  const hubLight = new PointLight(0xe5ad50, 18, 12, 1.6);
  root.add(hubLight);

  const glowTex = glowTexture();
  const ringTex = ringTexture();
  const disposables: { dispose(): void }[] = [glowTex, ringTex];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  /* ───────────── the hub ───────────── */
  const hub = new Group();
  root.add(hub);

  const hubGeo = track(new IcosahedronGeometry(1, 1));
  {
    // Copper at the bottom to saffron at the top, baked into vertex colors.
    const pos = hubGeo.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = clamp01((pos.getY(i) + 1) / 2);
      c.copy(COPPER).lerp(SAFFRON, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    hubGeo.setAttribute("color", new BufferAttribute(colors, 3));
  }
  const hubMat = track(
    new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      metalness: 0.35,
      roughness: 0.38,
      emissive: new Color("#8a3f14"),
      emissiveIntensity: 0.55,
    })
  );
  const hubMesh = new Mesh(hubGeo, hubMat);
  hub.add(hubMesh);

  const shellGeo = track(new EdgesGeometry(new IcosahedronGeometry(1.32, 1)));
  const shellMat = track(
    new LineBasicMaterial({ color: SAFFRON, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false })
  );
  const shell = new LineSegments(shellGeo, shellMat);
  hub.add(shell);

  const hubGlowMat = track(
    new SpriteMaterial({ map: glowTex, color: new Color("#e79a4a"), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 })
  );
  const hubGlow = new Sprite(hubGlowMat);
  hubGlow.scale.setScalar(6.6);
  hub.add(hubGlow);

  const hubCoreMat = track(
    new SpriteMaterial({ map: glowTex, color: new Color("#fff0cf"), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })
  );
  const hubCore = new Sprite(hubCoreMat);
  hubCore.scale.setScalar(2.4);
  hub.add(hubCore);

  /* ───────────── dust ───────────── */
  {
    const n = 140;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 3 + Math.random() * 5.5;
      const th = Math.random() * Math.PI * 2;
      const ph = (Math.random() - 0.5) * Math.PI * 0.8;
      arr[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      arr[i * 3 + 1] = Math.sin(ph) * r * 0.6;
      arr[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
    }
    const g = track(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(arr, 3));
    const m = track(
      new PointsMaterial({ size: 0.06, map: glowTex, color: new Color("#e5ad50"), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })
    );
    root.add(new Points(g, m));
  }

  /* ───────────── agents on tilted orbits ───────────── */
  const nodeGeo = track(new SphereGeometry(0.26, 24, 16));
  const circleGeo = (() => {
    const pts = new Float32Array(96 * 3);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts[i * 3] = Math.cos(a);
      pts[i * 3 + 2] = Math.sin(a);
    }
    const g = track(new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(pts, 3));
    return g;
  })();

  type Node = {
    agent: Agent;
    color: Color;
    ring: Group;
    radius: number;
    speed: number;
    phase: number;
    mesh: Mesh;
    glow: Sprite;
    glowMat: SpriteMaterial;
    denyMat: SpriteMaterial;
    deny: Sprite;
    threadGeo: BufferGeometry;
    threadMat: LineBasicMaterial;
    curve: QuadraticBezierCurve3;
    world: Vector3;
    label: HTMLSpanElement;
    active: number; // 0..1 thread highlight
    denied: number; // 0..1 red pulse
    dir: number;
  };

  const nodes: Node[] = AGENTS.map((agent, i) => {
    const color = new Color(agent.color);
    const ring = new Group();
    // Tilt each orbit differently so the system reads as 3D from any angle.
    ring.rotation.x = 0.32 + (i % 3) * 0.22 - 0.2;
    ring.rotation.z = (i - 2.5) * 0.17;
    root.add(ring);

    const radius = 2.85 + (i % 3) * 0.45 + (i > 2 ? 0.2 : 0);
    const ringMat = track(new LineBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }));
    const orbit = new LineLoop(circleGeo, ringMat);
    orbit.scale.setScalar(radius);
    ring.add(orbit);

    const mat = track(
      new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.1 })
    );
    const mesh = new Mesh(nodeGeo, mat);
    ring.add(mesh);

    const glowMat = track(
      new SpriteMaterial({ map: glowTex, color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 })
    );
    const glow = new Sprite(glowMat);
    glow.scale.setScalar(1.5);
    mesh.add(glow);

    const denyMat = track(
      new SpriteMaterial({ map: ringTex, color: CLAY, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
    );
    const deny = new Sprite(denyMat);
    deny.scale.setScalar(0.9);
    mesh.add(deny);

    const threadGeo = track(new BufferGeometry());
    threadGeo.setAttribute("position", new BufferAttribute(new Float32Array((THREAD_SEGS + 1) * 3), 3));
    threadGeo.setAttribute("color", new BufferAttribute(new Float32Array((THREAD_SEGS + 1) * 3), 3));
    const threadMat = track(
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })
    );
    const thread = new Line(threadGeo, threadMat);
    thread.frustumCulled = false;
    root.add(thread);

    const label = document.createElement("span");
    label.className = "hs-label";
    label.style.setProperty("--c", agent.color);
    label.textContent = agent.name;
    labelLayer.appendChild(label);

    return {
      agent,
      color,
      ring,
      radius,
      speed: (0.11 + (i % 4) * 0.025) * (i % 2 ? -1 : 1),
      phase: (i / AGENTS.length) * Math.PI * 2 + i * 0.4,
      mesh,
      glow,
      glowMat,
      denyMat,
      deny,
      threadGeo,
      threadMat,
      curve: new QuadraticBezierCurve3(new Vector3(), new Vector3(), new Vector3()),
      world: new Vector3(),
      label,
      active: 0,
      denied: 0,
      dir: i % 2 ? 1 : -1,
    };
  });

  const hubLabel = document.createElement("span");
  hubLabel.className = "hs-label hs-label-hub";
  hubLabel.textContent = "your room, on 127.0.0.1";
  labelLayer.appendChild(hubLabel);

  /* ───────────── travelling messages ───────────── */
  const pCount = nodes.length * PARTICLES_PER_THREAD;
  const pGeo = track(new BufferGeometry());
  pGeo.setAttribute("position", new BufferAttribute(new Float32Array(pCount * 3), 3));
  const pColors = new Float32Array(pCount * 3);
  nodes.forEach((n, i) => {
    for (let k = 0; k < PARTICLES_PER_THREAD; k++) {
      const j = i * PARTICLES_PER_THREAD + k;
      pColors[j * 3] = n.color.r;
      pColors[j * 3 + 1] = n.color.g;
      pColors[j * 3 + 2] = n.color.b;
    }
  });
  pGeo.setAttribute("color", new BufferAttribute(pColors, 3));
  const pMat = track(
    new PointsMaterial({ size: 0.34, map: glowTex, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false })
  );
  const particles = new Points(pGeo, pMat);
  particles.frustumCulled = false;
  root.add(particles);

  /* ───────────── file cards ───────────── */
  const cardGeo = track(new BoxGeometry(0.46, 0.6, 0.05));
  const cardEdgeGeo = track(new EdgesGeometry(cardGeo));
  const HOME_SPOTS = [
    new Vector3(-2.1, 1.75, 1.2),
    new Vector3(2.3, 1.45, -0.6),
    new Vector3(-1.7, -1.7, -0.9),
    new Vector3(2.0, -1.55, 1.3),
  ];

  type FileCard = {
    name: string;
    obj: Group;
    mat: MeshStandardMaterial;
    edgeMat: LineBasicMaterial;
    home: Vector3;
    holder: Node | null;
    from: Vector3;
    t: number; // 0..1 travel progress
    releasing: boolean;
    label: HTMLSpanElement;
  };

  const files: FileCard[] = FILES.map((name, i) => {
    const obj = new Group();
    const mat = track(
      new MeshStandardMaterial({ color: PARCHMENT, emissive: new Color("#3a2a18"), emissiveIntensity: 0.6, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.92 })
    );
    const card = new Mesh(cardGeo, mat);
    const edgeMat = track(new LineBasicMaterial({ color: SAFFRON, transparent: true, opacity: 0.6 }));
    const edge = new LineSegments(cardEdgeGeo, edgeMat);
    obj.add(card, edge);
    obj.position.copy(HOME_SPOTS[i]);
    root.add(obj);
    const label = document.createElement("span");
    label.className = "hs-file";
    label.textContent = name;
    labelLayer.appendChild(label);
    return { name, obj, mat, edgeMat, home: HOME_SPOTS[i].clone(), holder: null, from: new Vector3(), t: 0, releasing: false, label };
  });

  const toast = document.createElement("span");
  toast.className = "hs-toast";
  labelLayer.appendChild(toast);
  let toastUntil = 0;
  let toastFile: FileCard | null = null;

  /* ───────────── choreography ───────────── */
  // A small deterministic script: agents claim files, hold them, release;
  // every other claim, a second agent reaches for the held file and is denied.
  let nextEvent = 1.2;
  let step = 0;
  const holdTimers = new Map<FileCard, number>();

  function claim(file: FileCard, node: Node, now: number) {
    file.holder = node;
    file.from.copy(file.obj.position);
    file.t = 0;
    file.releasing = false;
    file.edgeMat.color.copy(node.color);
    file.edgeMat.opacity = 1;
    holdTimers.set(file, now + 5.2);
  }
  function release(file: FileCard) {
    file.from.copy(file.obj.position);
    file.t = 0;
    file.releasing = true;
    file.holder = null;
    file.edgeMat.color.copy(SAFFRON);
    file.edgeMat.opacity = 0.6;
    holdTimers.delete(file);
  }

  function tick(now: number) {
    for (const [f, until] of holdTimers) if (now > until) release(f);
    if (now < nextEvent) return;
    const free = files.filter((f) => !f.holder && !f.releasing);
    const held = files.filter((f) => f.holder && f.t >= 1);
    const busy = new Set(files.map((f) => f.holder).filter(Boolean));
    if (step % 2 === 1 && held.length) {
      const f = held[step % held.length];
      const others = nodes.filter((n) => n !== f.holder && !busy.has(n));
      const n = others[(step * 7) % others.length];
      if (n) {
        n.denied = 1;
        toast.textContent = `${n.agent.name} denied: ${f.name} is held by ${f.holder!.agent.name}`;
        toast.style.setProperty("--c", n.agent.color);
        toastUntil = now + 2.2;
        toastFile = f;
      }
    } else if (free.length) {
      const f = free[step % free.length];
      const candidates = nodes.filter((n) => !busy.has(n));
      const n = candidates[(step * 5) % candidates.length];
      if (n) claim(f, n, now);
    }
    step++;
    nextEvent = now + 1.9;
  }

  /* ───────────── interaction ───────────── */
  let yaw = 0;
  let yawVel = 0;
  let pitch = 0;
  let parX = 0;
  let parY = 0;
  let tParX = 0;
  let tParY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    tParX = ((e.clientX - r.left) / r.width - 0.5) * 2;
    tParY = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.006;
      yawVel = dx * 0.006 * 30;
      pitch = Math.max(-0.35, Math.min(0.45, pitch + dy * 0.003));
      if (opts.reducedMotion) renderOnce();
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    host.classList.add("is-dragging");
  };
  const onPointerUp = () => {
    dragging = false;
    host.classList.remove("is-dragging");
  };
  const onPointerLeave = () => {
    tParX = 0;
    tParY = 0;
  };
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointerleave", onPointerLeave);

  /* ───────────── sizing ───────────── */
  let width = 1;
  let height = 1;
  const resize = () => {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Pull the camera back on narrow/tall boxes so the orbits never clip.
    // Labels are fixed-size DOM, so small boxes get a little more room around the orbits.
    const small = 1 + Math.max(0, 640 - Math.min(width, height)) / 640 * 0.45;
    const base = 14.8 * small;
    const fit = camera.aspect < 1 ? base / Math.max(camera.aspect, 0.62) : base;
    camera.position.set(0, 1.6, fit);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (!running) renderOnce();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  /* ───────────── frame ───────────── */
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const ctrl = new Vector3();
  const threadColor = new Color();
  let time = 0;

  function update(dt: number) {
    time += dt;
    tick(time);

    // Idle auto-rotation, drag momentum and a little pointer parallax.
    if (!dragging) {
      yawVel *= Math.pow(0.04, dt);
      yaw += (0.09 + yawVel) * dt;
    }
    parX += (tParX - parX) * Math.min(1, dt * 3);
    parY += (tParY - parY) * Math.min(1, dt * 3);
    root.rotation.y = yaw + parX * 0.18;
    root.rotation.x = pitch + parY * 0.1;

    // Hub breathing.
    const breath = 0.5 + 0.5 * Math.sin(time * 1.4);
    hubMesh.rotation.y = time * 0.18;
    hubMesh.rotation.x = Math.sin(time * 0.3) * 0.2;
    shell.rotation.y = -time * 0.08;
    shell.rotation.z = time * 0.05;
    hubGlow.scale.setScalar(6 + breath * 1.4);
    hubGlowMat.opacity = 0.6 + breath * 0.3;
    hubCoreMat.opacity = 0.35 + breath * 0.3;
    hubMat.emissiveIntensity = 0.45 + breath * 0.35;
    hubLight.intensity = 14 + breath * 8;

    root.updateMatrixWorld();
    const pPos = pGeo.getAttribute("position") as BufferAttribute;

    nodes.forEach((n, i) => {
      const a = n.phase + time * n.speed;
      n.mesh.position.set(Math.cos(a) * n.radius, 0, Math.sin(a) * n.radius);
      n.mesh.updateMatrixWorld();
      n.mesh.getWorldPosition(tmp);
      n.world.copy(tmp);
      root.worldToLocal(n.world);

      const holding = files.some((f) => f.holder === n);
      n.active += ((holding ? 1 : 0) - n.active) * Math.min(1, dt * 4);
      n.denied = Math.max(0, n.denied - dt * 0.8);

      // Thread: hub → node, bowed outward and up.
      ctrl.copy(n.world).multiplyScalar(0.5);
      tmp2.copy(n.world).normalize();
      ctrl.addScaledVector(tmp2, 0.6);
      ctrl.y += 1.1 + (i % 2) * 0.4;
      n.curve.v0.set(0, 0, 0);
      n.curve.v1.copy(ctrl);
      n.curve.v2.copy(n.world);

      const pos = n.threadGeo.getAttribute("position") as BufferAttribute;
      const col = n.threadGeo.getAttribute("color") as BufferAttribute;
      const deny = n.denied > 0 ? Math.sin(n.denied * Math.PI) : 0;
      for (let s = 0; s <= THREAD_SEGS; s++) {
        const u = s / THREAD_SEGS;
        n.curve.getPoint(u, tmp);
        pos.setXYZ(s, tmp.x, tmp.y, tmp.z);
        // Fade from warm hub color into the agent's color.
        threadColor.copy(SAFFRON).lerp(n.color, u);
        if (deny > 0) threadColor.lerp(CLAY, deny);
        const k = 0.35 + n.active * 0.65 + deny * 0.6;
        col.setXYZ(s, threadColor.r * k, threadColor.g * k, threadColor.b * k);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      n.threadMat.opacity = 0.5 + n.active * 0.4 + deny * 0.3;

      n.glowMat.opacity = 0.55 + n.active * 0.35;
      n.glow.scale.setScalar(1.3 + n.active * 0.5);
      n.denyMat.opacity = deny * 0.95;
      n.deny.scale.setScalar(0.7 + (1 - n.denied) * 1.4);

      // Messages flow both ways; faster while the agent holds a claim.
      const speed = 0.28 + n.active * 0.25;
      for (let k = 0; k < PARTICLES_PER_THREAD; k++) {
        let u = (time * speed + k / PARTICLES_PER_THREAD + i * 0.13) % 1;
        if (n.dir < 0) u = 1 - u;
        n.curve.getPoint(u, tmp);
        pPos.setXYZ(i * PARTICLES_PER_THREAD + k, tmp.x, tmp.y, tmp.z);
      }
    });
    pPos.needsUpdate = true;

    // Files: float at home, snap to a claiming agent, drift back on release.
    files.forEach((f, i) => {
      const bob = Math.sin(time * 1.1 + i * 1.7) * 0.12;
      if (f.holder) {
        f.t = Math.min(1, f.t + dt / 0.75);
        tmp.copy(f.holder.world);
        tmp2.copy(tmp).normalize().multiplyScalar(0.62);
        tmp.add(tmp2);
        tmp.y += 0.5;
        f.obj.position.lerpVectors(f.from, tmp, easeOutBack(f.t));
        f.obj.scale.setScalar(0.9 + 0.1 * (1 - f.t));
      } else if (f.releasing) {
        f.t = Math.min(1, f.t + dt / 1.4);
        tmp.copy(f.home);
        tmp.y += bob;
        f.obj.position.lerpVectors(f.from, tmp, easeInOut(f.t));
        if (f.t >= 1) f.releasing = false;
      } else {
        f.obj.position.set(f.home.x, f.home.y + bob, f.home.z);
      }
      f.obj.rotation.set(Math.sin(time * 0.7 + i) * 0.25, time * 0.5 + i, Math.sin(time * 0.5 + i * 2) * 0.12);
    });
  }

  const project = (v: Vector3, out: { x: number; y: number; z: number }) => {
    tmp.copy(v);
    root.localToWorld(tmp);
    tmp.project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * width;
    out.y = (-tmp.y * 0.5 + 0.5) * height;
    out.z = tmp.z;
  };
  const scr = { x: 0, y: 0, z: 0 };
  const HUB_LABEL_AT = new Vector3(0, -1.55, 0);

  function placeLabels() {
    // Depth of each node relative to the hub decides how solid its label reads.
    tmp2.set(0, 0, 0);
    root.localToWorld(tmp2);
    const hubDist = camera.position.distanceTo(tmp2);
    nodes.forEach((n) => {
      project(n.world, scr);
      tmp.copy(n.world);
      root.localToWorld(tmp);
      const d = camera.position.distanceTo(tmp) - hubDist; // <0 = in front
      const o = clamp01(0.95 - d * 0.22);
      n.label.style.transform = `translate(${scr.x.toFixed(1)}px, ${(scr.y + 20).toFixed(1)}px) translate(-50%, 0)`;
      n.label.style.opacity = o.toFixed(2);
      n.label.classList.toggle("is-active", n.active > 0.5);
      n.label.classList.toggle("is-denied", n.denied > 0.15);
    });
    project(HUB_LABEL_AT, scr);
    hubLabel.style.transform = `translate(${scr.x.toFixed(1)}px, ${scr.y.toFixed(1)}px) translate(-50%, 0)`;

    files.forEach((f) => {
      project(f.obj.position, scr);
      f.label.style.transform = `translate(${scr.x.toFixed(1)}px, ${(scr.y - 30).toFixed(1)}px) translate(-50%, -100%)`;
      f.label.classList.toggle("is-held", !!f.holder);
      f.label.style.setProperty("--c", f.holder ? f.holder.agent.color : "");
    });

    const showToast = toastFile && time < toastUntil;
    toast.classList.toggle("is-on", !!showToast);
    if (showToast && toastFile) {
      project(toastFile.obj.position, scr);
      const half = toast.offsetWidth / 2 + 14;
      const x = Math.min(width - half, Math.max(half, scr.x));
      toast.style.transform = `translate(${x.toFixed(1)}px, ${(scr.y + 26).toFixed(1)}px) translate(-50%, 0)`;
    }
  }

  function renderOnce() {
    placeLabels();
    renderer.render(scene, camera);
  }

  let running = false;
  let raf = 0;
  let last = 0;
  let firstFrame = true;
  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    update(dt);
    renderOnce();
    if (firstFrame) {
      firstFrame = false;
      opts.onFirstFrame?.();
    }
  };

  resize();

  if (opts.reducedMotion) {
    // One composed still: a claim in place and a denied reach, no animation.
    time = 0;
    claim(files[0], nodes[0], 0);
    files[0].t = 1;
    claim(files[2], nodes[1], 0);
    files[2].t = 1;
    nodes[2].denied = 0.5;
    nextEvent = Infinity;
    yaw = 0.5;
    update(0);
    nodes[0].active = 1;
    nodes[1].active = 1;
    toast.textContent = `${nodes[2].agent.name} denied: ${files[0].name} is held by ${nodes[0].agent.name}`;
    toast.style.setProperty("--c", nodes[2].agent.color);
    toastFile = files[0];
    toastUntil = Infinity;
    update(0);
    renderOnce();
    opts.onFirstFrame?.();
  }

  return {
    setRunning(on: boolean) {
      if (opts.reducedMotion) return;
      if (on === running) return;
      running = on;
      if (on) {
        last = 0;
        raf = requestAnimationFrame(loop);
      } else {
        cancelAnimationFrame(raf);
      }
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointerleave", onPointerLeave);
      scene.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labelLayer.remove();
    },
  };
}
