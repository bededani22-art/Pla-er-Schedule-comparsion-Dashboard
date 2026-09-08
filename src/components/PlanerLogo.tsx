export function PlanerLogo({ size = 34 }: { size?: number }) {
  const points = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Plaነer medallion"
      className="shrink-0"
    >
      <circle cx="50" cy="50" r="48" fill="var(--panel)" stroke="var(--ink)" strokeWidth="2" />
      {points.map((deg, i) => (
        <polygon
          key={deg}
          points="50,6 58,22 50,32 42,22"
          fill={i % 2 === 0 ? "var(--maroon)" : "var(--mustard)"}
          transform={`rotate(${deg} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="26" fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.5" />
      {points.map((deg) => (
        <line
          key={`t${deg}`}
          x1="50"
          y1="26"
          x2="50"
          y2="34"
          stroke="var(--ink)"
          strokeWidth="1.2"
          transform={`rotate(${deg} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="6" fill="var(--mustard)" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="2.4" fill="var(--maroon)" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <PlanerLogo />
      <div className="leading-none">
        <p className="font-mono text-xl font-bold tracking-tight">Plaነer</p>
        <p className="mono-label mt-1 text-[0.6rem] text-muted-foreground">B-ዕድ</p>
      </div>
    </div>
  );
}
