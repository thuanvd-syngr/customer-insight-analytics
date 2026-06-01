import { describe, expect, it } from "vitest";

import { getConfigHealth, getHealth } from "~/lib/health.server";

describe("health", () => {
  it("returns ok health", () => {
    expect(getHealth(new Date("2026-06-01T00:00:00Z")).status).toBe("ok");
  });

  it("checks required env", () => {
    const env = {
      SHOPIFY_API_KEY: "x",
      SHOPIFY_API_SECRET: "x",
      SHOPIFY_APP_URL: "https://example.com",
      DATABASE_URL: "postgres://x",
      SCOPES: "read_products",
      NODE_ENV: "production",
    } as unknown as NodeJS.ProcessEnv;
    expect(getConfigHealth(env)).toMatchObject({ status: "ok", missing: [] });
    expect(getConfigHealth({ ...env, DATABASE_URL: "" }).status).toBe("degraded");
    expect(getConfigHealth(env).missing).not.toContain("GROQ_API_KEY");
  });

  it("does not expose secret checks or values", () => {
    const env = {
      SHOPIFY_API_KEY: "public-key",
      SHOPIFY_API_SECRET: "super-secret",
      SHOPIFY_APP_URL: "https://example.com",
      DATABASE_URL: "postgres://user:password@host/db",
      SCOPES: "read_products",
      NODE_ENV: "production",
      GROQ_API_KEY: "ai-secret",
    } as unknown as NodeJS.ProcessEnv;
    const result = getConfigHealth(env);
    expect(Object.keys(result.checks)).not.toContain("SHOPIFY_API_SECRET");
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("ai-secret");
  });

  it("accepts HOST when SHOPIFY_APP_URL is absent", () => {
    const env = {
      SHOPIFY_API_KEY: "x",
      HOST: "https://example.com",
      DATABASE_URL: "postgres://x",
      SCOPES: "read_products",
      NODE_ENV: "production",
    } as unknown as NodeJS.ProcessEnv;
    expect(getConfigHealth(env).missing).not.toContain("SHOPIFY_APP_URL_OR_HOST");
  });
});
