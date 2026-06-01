import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Tests target the pure logic in app/lib (engine, billing, usage, import,
// webhook cleanup, health). We deliberately do NOT load the Remix Vite plugin
// here so tests stay fast and free of Shopify app bootstrapping.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}", "app/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "build", ".cache"],
    clearMocks: true,
    restoreMocks: true,
  },
});
