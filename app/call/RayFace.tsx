/** Ray on the call: a cartoon journeyman whose mouth moves when he talks, who blinks, and glances toward the part he points at. */
export default function RayFace({ talking, mood, look, head = false }: { talking: boolean; mood: "ok" | "happy" | "worried"; look: number; head?: boolean }) {
  const px = Math.max(-1, Math.min(1, look)) * 1.8;
  const box = { transformBox: "fill-box" as const, transformOrigin: "center" };
  return (
    <svg viewBox={head ? "12 14 76 80" : "0 0 100 130"} className="h-full w-full" aria-label="Ray">
      <defs>
        <radialGradient id="rayBg" cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#5A3A24" />
          <stop offset="100%" stopColor="#1A120C" />
        </radialGradient>
      </defs>
      <rect width="100" height="130" fill="url(#rayBg)" />
      {/* shoulders, work shirt */}
      <path d="M6 130 C10 104 30 96 50 96 C70 96 90 104 94 130 Z" fill="#2E4A6B" />
      <path d="M40 96 L50 110 L60 96 Z" fill="#E8E2D6" />
      <rect x="42" y="82" width="16" height="16" rx="6" fill="#B97B52" />
      {/* face and ears */}
      <circle cx="26" cy="64" r="5" fill="#C98A5E" />
      <circle cx="74" cy="64" r="5" fill="#C98A5E" />
      <ellipse cx="50" cy="63" rx="24" ry="27" fill="#D39A6C" />
      {/* hard hat */}
      <path d="M22 52 C22 29 36 21 50 21 C64 21 78 29 78 52 Z" fill="#FF8A1F" />
      <rect x="15" y="48" width="70" height="7" rx="3.5" fill="#E46A08" />
      <rect x="47" y="22" width="6" height="27" rx="3" fill="#FFB25E" />
      {/* brows */}
      {mood === "worried" ? (
        <>
          <path d="M34 56 L45 53" stroke="#3B2414" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M66 56 L55 53" stroke="#3B2414" strokeWidth="2.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M35 55 Q40 52 45 55" stroke="#3B2414" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M55 55 Q60 52 65 55" stroke="#3B2414" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </>
      )}
      {/* eyes: blink, and look toward the part */}
      <g className="animate-[blink_4.2s_infinite]" style={box}>
        <ellipse cx="40" cy="63" rx="4.6" ry="4" fill="#fff" />
        <ellipse cx="60" cy="63" rx="4.6" ry="4" fill="#fff" />
        <circle cx={40 + px} cy="63.4" r="2.3" fill="#20140C" />
        <circle cx={60 + px} cy="63.4" r="2.3" fill="#20140C" />
      </g>
      {/* mustache */}
      <path d="M37 78 C43 73 48 75 50 76.5 C52 75 57 73 63 78 C57 80 53 79 50 79 C47 79 43 80 37 78 Z" fill="#4A2E1A" />
      {/* mouth */}
      {talking ? (
        <ellipse cx="50" cy="84" rx="5.5" ry="3.4" fill="#5B1F1F" className="animate-[talk_.22s_ease-in-out_infinite_alternate]" style={box} />
      ) : mood === "happy" ? (
        <path d="M42 83 Q50 90 58 83" stroke="#5B1F1F" strokeWidth="2.6" fill="#7A2B2B" strokeLinecap="round" />
      ) : mood === "worried" ? (
        <path d="M43 86 Q50 82 57 86" stroke="#5B1F1F" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M43 83.5 Q50 87.5 57 83.5" stroke="#5B1F1F" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}
