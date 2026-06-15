import * as THREE from "three";

/**
 * "Loom" — a fullscreen GLSL field of warm flowing threads that weave and part
 * around the cursor. One quad, one fragment shader: no geometry cost, no lights.
 * DPR-clamped, pauses when the tab is hidden. Returns a cleanup function.
 */
const FRAG = /* glsl */ `
precision highp float;
uniform float u_time;
uniform vec2  u_res;
uniform vec2  u_mouse;
uniform float u_mouseV;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0,0.0));
  float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);

  vec3 col = vec3(0.078, 0.066, 0.051);           // warm ink base

  vec2 m = vec2(u_mouse.x * aspect, u_mouse.y);
  float md = distance(p, m);
  float mInfluence = exp(-md*md*7.0) * (0.18 + 0.6*u_mouseV);

  vec3 copper  = vec3(0.81, 0.48, 0.235);
  vec3 saffron = vec3(0.886, 0.66, 0.30);

  // horizontal flowing threads
  const int N = 14;
  for(int i=0;i<N;i++){
    float fi = float(i);
    float baseY = (fi + 0.5) / float(N);
    float speed = 0.018 + mod(fi, 3.0) * 0.011;
    float amp   = 0.05 + 0.02 * sin(fi * 1.7);
    float w = fbm(vec2(p.x * 1.5 + u_time * speed * 6.0, fi * 3.1)) - 0.5;
    float y = baseY + w * amp * 2.0;
    y += (p.y > m.y ? 1.0 : -1.0) * mInfluence * 0.05;
    float d = abs(p.y - y);
    float line = smoothstep(0.0065, 0.0, d);
    float t = 0.5 + 0.5 * sin(fi * 0.9 + p.x * 2.0 + u_time * 0.1);
    vec3 c = mix(copper, saffron, t);
    float glow = 0.5 + 0.5 * fbm(vec2(p.x * 2.0 - u_time * 0.1, fi));
    col += c * line * (0.09 + 0.16 * glow) * (0.55 + mInfluence * 2.2);
  }

  // faint vertical weave — a teal whisper
  const int M = 9;
  for(int j=0;j<M;j++){
    float fj = float(j);
    float baseX = (fj + 0.5) / float(M) * aspect;
    float wx = fbm(vec2(fj * 2.7, p.y * 1.3 - u_time * 0.12)) - 0.5;
    float x = baseX + wx * 0.05;
    float line = smoothstep(0.004, 0.0, abs(p.x - x));
    col += vec3(0.39, 0.68, 0.56) * line * 0.022;
  }

  float vig = smoothstep(1.18, 0.32, distance(uv, vec2(0.5)));
  col *= 0.72 + 0.28 * vig;
  col += vec3(0.12, 0.07, 0.03) * exp(-distance(uv, vec2(0.82, 0.92)) * 2.2) * 0.55;

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

  const clock = new THREE.Clock();
  let raf = 0;
  let visible = true;

  function frame() {
    uniforms.u_time.value = clock.getElapsedTime();
    uniforms.u_mouse.value.lerp(target, 0.06);
    uniforms.u_mouseV.value += (targetV - uniforms.u_mouseV.value) * 0.05;
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
    document.removeEventListener("visibilitychange", onVisibility);
    quad.geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}
