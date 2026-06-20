import * as THREE from "three";

/**
 * "Loom" — a fullscreen GLSL field of warm flowing threads that weave and part
 * around the cursor, with drifting motes and a soft glow trail. One quad, one
 * fragment shader: no geometry cost, no lights. DPR-clamped, scroll-parallaxed,
 * pauses when the tab is hidden. Returns a cleanup function.
 */
const FRAG = /* glsl */ `
precision highp float;
uniform float u_time;
uniform vec2  u_res;
uniform vec2  u_mouse;   // 0..1, y-up
uniform float u_mouseV;  // recent pointer velocity, 0..1
uniform float u_scroll;  // page scroll in viewport units

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0,0.0));
  float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);

  // gentle parallax: the field drifts up slightly as you scroll
  p.y += u_scroll * 0.12;

  vec3 col = vec3(0.072, 0.061, 0.047);            // warm ink base

  vec2 m = vec2(u_mouse.x * aspect, u_mouse.y);
  float md = distance(p, vec2(m.x, m.y - u_scroll * 0.12));
  float mInfluence = exp(-md*md*6.0) * (0.22 + 0.7*u_mouseV);

  vec3 copper  = vec3(0.83, 0.49, 0.235);
  vec3 saffron = vec3(0.90, 0.67, 0.31);
  vec3 teal    = vec3(0.39, 0.70, 0.57);

  // ---- horizontal flowing threads (brighter, more present) ----
  const int N = 18;
  for(int i=0;i<N;i++){
    float fi = float(i);
    float baseY = (fi + 0.5) / float(N);
    float speed = 0.020 + mod(fi, 3.0) * 0.013;
    float amp   = 0.055 + 0.025 * sin(fi * 1.7);
    float w = fbm(vec2(p.x * 1.6 + u_time * speed * 6.0, fi * 3.1)) - 0.5;
    float y = baseY + w * amp * 2.0;
    // threads bow away from the cursor
    y += (p.y > m.y ? 1.0 : -1.0) * mInfluence * 0.06;
    float d = abs(p.y - y);
    float line = smoothstep(0.0075, 0.0, d);
    float t = 0.5 + 0.5 * sin(fi * 0.9 + p.x * 2.0 + u_time * 0.12);
    vec3 c = mix(copper, saffron, t);
    // a few threads carry a teal whisper
    c = mix(c, teal, step(2.5, mod(fi, 6.0)) * 0.5);
    float glow = 0.5 + 0.5 * fbm(vec2(p.x * 2.0 - u_time * 0.1, fi));
    col += c * line * (0.12 + 0.20 * glow) * (0.6 + mInfluence * 2.6);
  }

  // ---- faint vertical weave ----
  const int M = 11;
  for(int j=0;j<M;j++){
    float fj = float(j);
    float baseX = (fj + 0.5) / float(M) * aspect;
    float wx = fbm(vec2(fj * 2.7, p.y * 1.3 - u_time * 0.12)) - 0.5;
    float x = baseX + wx * 0.05;
    float line = smoothstep(0.004, 0.0, abs(p.x - x));
    col += teal * line * 0.03;
  }

  // ---- drifting motes (woven knots of light) ----
  const int K = 22;
  for(int k=0;k<K;k++){
    float fk = float(k);
    float seed = hash(vec2(fk, 7.0));
    float sp = 0.02 + seed * 0.05;
    float mx = fract(seed * 3.3 + u_time * sp) * aspect;
    float my = fract(hash(vec2(fk, 19.0)) + 0.13 * sin(u_time * 0.2 + fk));
    vec2 mp = vec2(mx, my);
    float dd = distance(p, mp);
    float spark = exp(-dd*dd*900.0);
    vec3 mc = mix(saffron, teal, step(0.66, seed));
    col += mc * spark * (0.5 + 0.5 * sin(u_time * 1.3 + fk));
  }

  // ---- cursor glow halo ----
  col += mix(copper, saffron, 0.4) * exp(-md*md*22.0) * (0.10 + 0.5 * u_mouseV);

  // ---- vignette + corner aurora ----
  float vig = smoothstep(1.20, 0.30, distance(uv, vec2(0.5)));
  col *= 0.70 + 0.30 * vig;
  col += vec3(0.13, 0.08, 0.035) * exp(-distance(uv, vec2(0.84, 0.92)) * 2.0) * 0.6;
  col += teal * 0.05 * exp(-distance(uv, vec2(0.10, 0.06)) * 2.4);

  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createWovenBackground(canvas: HTMLCanvasElement): () => void {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    u_time: { value: 0 },
    u_res: { value: new THREE.Vector2(1, 1) },
    u_mouse: { value: new THREE.Vector2(0.7, 0.85) },
    u_mouseV: { value: 0 },
    u_scroll: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.u_res.value.set(w * dpr, h * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  const target = new THREE.Vector2(0.7, 0.85);
  let targetV = 0;
  function onMove(e: PointerEvent) {
    target.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
    targetV = 1;
  }
  window.addEventListener("pointermove", onMove, { passive: true });

  let scrollTarget = 0;
  function onScroll() {
    scrollTarget = window.scrollY / Math.max(window.innerHeight, 1);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const clock = new THREE.Clock();
  let raf = 0;
  let visible = true;

  function frame() {
    uniforms.u_time.value = clock.getElapsedTime();
    uniforms.u_mouse.value.lerp(target, 0.06);
    uniforms.u_mouseV.value += (targetV - uniforms.u_mouseV.value) * 0.05;
    uniforms.u_scroll.value += (scrollTarget - uniforms.u_scroll.value) * 0.08;
    targetV *= 0.95;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  frame();

  function onVisibility() {
    if (document.hidden) {
      visible = false;
      cancelAnimationFrame(raf);
    } else if (!visible) {
      visible = true;
      clock.getDelta(); // drop the gap so motion doesn't jump
      frame();
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    quad.geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}
