export default function ThreadMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id="tm" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#cf7a3c" />
          <stop offset="1" stopColor="#e2a94c" />
        </linearGradient>
      </defs>
      {/* two interlacing strands forming a woven knot */}
      <path
        d="M5 21c6-14 16-14 22 0"
        stroke="url(#tm)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M5 11c6 14 16 14 22 0"
        stroke="#63ad8f"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.85"
      />
      <circle cx="16" cy="16" r="2.1" fill="#ece4d3" />
    </svg>
  );
}
