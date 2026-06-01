import { describe, expect, it } from "vitest";

import {
  filterNewSampleMessages,
  getSampleMessages,
} from "~/lib/sample-data";

describe("sample data", () => {
  it("uses stable external ids for idempotent inserts", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const first = getSampleMessages(now);
    const second = getSampleMessages(now);

    expect(first.map((message) => message.externalId)).toEqual(
      second.map((message) => message.externalId),
    );
    expect(
      filterNewSampleMessages(
        second,
        first.map((message) => message.externalId ?? null),
      ),
    ).toHaveLength(0);
  });
});
