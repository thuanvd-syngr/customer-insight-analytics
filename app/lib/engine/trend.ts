import type { NormalizedMessage, TrendPoint } from "~/lib/types";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function pctChange(previous: number, recent: number): number {
  if (previous === 0) return recent > 0 ? 1 : 0;
  return (recent - previous) / previous;
}

export function computeTrend(
  timestamps: Date[],
  now: Date,
  windowDays: number,
): number {
  const end = now.getTime();
  const recentStart = end - windowDays * 86_400_000;
  const previousStart = end - windowDays * 2 * 86_400_000;
  let recent = 0;
  let previous = 0;

  for (const timestamp of timestamps) {
    const time = timestamp.getTime();
    if (time > recentStart && time <= end) recent += 1;
    else if (time > previousStart && time <= recentStart) previous += 1;
  }

  return pctChange(previous, recent);
}

export function dailyVolume(
  messages: NormalizedMessage[],
  now: Date,
  days: number,
): TrendPoint[] {
  const endDay = startOfUtcDay(now);
  const buckets = new Map<string, number>();
  const points: TrendPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(endDay.getTime() - offset * 86_400_000);
    const key = isoDay(date);
    buckets.set(key, 0);
    points.push({ date: key, count: 0 });
  }

  for (const message of messages) {
    const key = isoDay(startOfUtcDay(message.occurredAt));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return points.map((point) => ({ ...point, count: buckets.get(point.date) ?? 0 }));
}
