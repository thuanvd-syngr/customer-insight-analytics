import { toneVar, type Tone } from "./format";

export interface SparklineProps {
  points: number[];
  tone?: Tone;
  width?: number;
  height?: number;
}

/** Tiny inline SVG sparkline for table rows / compact trends. */
export function Sparkline({
  points,
  tone = "info",
  width = 80,
  height = 24,
}: SparklineProps) {
  const data = points ?? [];
  if (data.length < 2) {
    return <span aria-hidden="true" style={{ display: "inline-block", width }} />;
  }
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = max - min || 1;
  const n = data.length;
  const coords = data
    .map((v, i) => {
      const x = (i / (n - 1)) * width;
      const yv = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${yv.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} role="img" aria-label="Sparkline">
      <polyline
        points={coords}
        fill="none"
        stroke={toneVar(tone)}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
