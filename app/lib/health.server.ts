export interface HealthStatus {
  status: "ok";
  service: string;
  time: string;
}

export interface ConfigHealth {
  status: "ok" | "degraded";
  checks: Record<string, boolean>;
  missing: string[];
}

const REQUIRED = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_APP_URL_OR_HOST",
  "DATABASE_URL",
  "SCOPES",
  "NODE_ENV",
];

export function getHealth(now = new Date()): HealthStatus {
  return {
    status: "ok",
    service: "customer-insight-analytics",
    time: now.toISOString(),
  };
}

export function getConfigHealth(env: NodeJS.ProcessEnv = process.env): ConfigHealth {
  const checks: Record<string, boolean> = {
    SHOPIFY_API_KEY: Boolean(env.SHOPIFY_API_KEY),
    SHOPIFY_APP_URL_OR_HOST: Boolean(env.SHOPIFY_APP_URL || env.HOST),
    DATABASE_URL: Boolean(env.DATABASE_URL),
    SCOPES: Boolean(env.SCOPES),
    NODE_ENV: Boolean(env.NODE_ENV),
  };
  const missing = REQUIRED.filter((key) => !checks[key]);
  return {
    status: missing.length === 0 ? "ok" : "degraded",
    checks,
    missing,
  };
}
