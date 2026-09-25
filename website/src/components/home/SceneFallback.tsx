const AGENTS = [
  { name: "Claude Code", color: "#e3aa70", x: 300, y: 92 },
  { name: "Cursor", color: "#92b9da", x: 506, y: 190 },
  { name: "Gemini CLI", color: "#a2c483", x: 488, y: 410 },
  { name: "Codex", color: "#c99fd8", x: 290, y: 500 },
  { name: "OpenCode", color: "#6fcab9", x: 96, y: 404 },
  { name: "Antigravity", color: "#e7c46a", x: 110, y: 176 },
];

/** Static version of the hero room: shown while three.js loads, and instead
 *  of it when WebGL isn't available. */
export default function SceneFallback() {
  const cx = 300;
  const cy = 300;
  return (
    <svg viewBox="0 0 600 600" className="hs-svg" role="img" aria-labelledby="hs-svg-t">
      <title id="hs-svg-t">Six AI coding agents connected by threads to one shared Bothread room</title>
      <defs>
        <radialGradient id="hsGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#f0b25c" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#d27d3e" stopOpacity="0.16" />
          <stop offset="1" stopColor="#d27d3e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hsHub" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#d27d3e" />
          <stop offset="1" stopColor="#e5ad50" />
        </linearGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx="230" ry="96" fill="none" stroke="#e5ad50" strokeOpacity="0.12" transform="rotate(-18 300 300)" />
      <ellipse cx={cx} cy={cy} rx="205" ry="150" fill="none" stroke="#92b9da" strokeOpacity="0.1" transform="rotate(24 300 300)" />
      <circle cx={cx} cy={cy} r="180" fill="url(#hsGlow)" />
      {AGENTS.map((a, i) => {
        const mx = (cx + a.x) / 2 + (a.y - cy) * 0.18;
        const my = (cy + a.y) / 2 - 40 - (i % 2) * 14;
        return (
          <g key={a.name}>
            <path d={`M${cx} ${cy} Q${mx} ${my} ${a.x} ${a.y}`} fill="none" stroke={a.color} strokeOpacity={i === 0 ? 0.9 : 0.4} strokeWidth={i === 0 ? 1.6 : 1.1} />
            <circle cx={a.x} cy={a.y} r="22" fill={a.color} opacity="0.18" />
            <circle cx={a.x} cy={a.y} r="11" fill={a.color} />
            <text x={a.x} y={a.y + 34} textAnchor="middle" className="hs-svg-label">
              {a.name}
            </text>
          </g>
        );
      })}
      <polygon points="300,246 347,273 347,327 300,354 253,327 253,273" fill="url(#hsHub)" />
      <polygon points="300,246 347,273 300,300 253,273" fill="#f3c47a" opacity="0.5" />
      <g transform="translate(330 64) rotate(8)">
        <rect width="30" height="38" rx="4" fill="#efe7d6" opacity="0.9" stroke="#e3aa70" strokeWidth="2" />
      </g>
      <g transform="translate(420 470) rotate(-10)">
        <rect width="30" height="38" rx="4" fill="#efe7d6" opacity="0.7" stroke="#e5ad50" />
      </g>
      <circle cx="488" cy="410" r="24" fill="none" stroke="#e0553d" strokeWidth="2" opacity="0.8" />
    </svg>
  );
}
