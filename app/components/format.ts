// Formatting + tone helpers shared across the merchant-facing UI kit.
// Pure, SSR-safe (uses Intl which is available in Node).

export type Tone = "success" | "warning" | "critical" | "info" | "subdued";

const usd = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

/** "$1,234" */
export function money(amount: number, currency = "USD"): string {
  return usd(currency).format(Math.round(amount || 0));
}

/** "$1.2k" / "$3.4M" for compact metric display. */
export function compactMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount || 0);
}

export function moneyRange(
  low: number | null | undefined,
  high: number | null | undefined,
  currency = "USD",
): string {
  const safeLow = Math.round(low || 0);
  const safeHigh = Math.round(high || 0);
  if (safeLow <= 0 && safeHigh <= 0) return "Recovery estimate pending";
  if (safeLow > 0 && safeHigh > safeLow) return `${money(safeLow, currency)}-${money(safeHigh, currency)}`;
  return money(Math.max(safeLow, safeHigh), currency);
}

export function metricFallback(value: string | null | undefined): string {
  const clean = value?.trim();
  return clean && clean !== "None" && clean !== "—" ? clean : "Add customer questions to reveal recovery actions";
}

/** "1,234" */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}

/** ratio 0.5 -> "+50%" (signed by default). */
export function formatPercent(ratio: number, opts?: { signed?: boolean }): string {
  const signed = opts?.signed ?? true;
  const pct = Math.round((ratio || 0) * 100);
  const sign = signed && pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

/** Health-style score: high is good. */
export function scoreTone(score: number): Tone {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "critical";
}

/**
 * Tone for a trend. For friction metrics a rising value is BAD, so up -> critical.
 * Set invert=true for metrics where rising is good (e.g. health).
 */
export function trendTone(ratio: number, invert = false): Tone {
  const up = (ratio || 0) > 0.001;
  const down = (ratio || 0) < -0.001;
  if (!up && !down) return "subdued";
  const risingIsGood = invert;
  if (up) return risingIsGood ? "success" : "critical";
  return risingIsGood ? "critical" : "success";
}

/** Map a Tone to a Polaris Text `tone` value. */
export function textTone(
  tone: Tone,
): "success" | "critical" | "caution" | "subdued" {
  switch (tone) {
    case "success":
      return "success";
    case "critical":
      return "critical";
    case "warning":
      return "caution";
    default:
      return "subdued";
  }
}

/** Map a Tone to a Polaris ProgressBar `tone`. */
export function progressTone(
  tone: Tone,
): "primary" | "success" | "critical" | "highlight" {
  switch (tone) {
    case "success":
      return "success";
    case "critical":
      return "critical";
    case "warning":
      return "highlight";
    default:
      return "primary";
  }
}

/** CSS custom property used to fill SVG charts/gauges with Polaris colors. */
export function toneVar(tone: Tone): string {
  switch (tone) {
    case "success":
      return "var(--p-color-bg-fill-success, #29845a)";
    case "warning":
      return "var(--p-color-bg-fill-caution, #ffb800)";
    case "critical":
      return "var(--p-color-bg-fill-critical, #e51c00)";
    case "info":
      return "var(--p-color-bg-fill-info, #0094d5)";
    default:
      return "var(--p-color-border, #8a8a8a)";
  }
}
