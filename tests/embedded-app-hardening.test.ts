import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("embedded app hardening", () => {
  it("does not use manual postMessage in app source", () => {
    const offenders = filesUnder("app")
      .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("postMessage"));

    expect(offenders).toEqual([]);
  });
});
