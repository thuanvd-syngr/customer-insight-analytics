import type { NormalizedMessage } from "~/lib/types";

export interface ParsedMessage {
  content: string;
  occurredAt: Date;
  source: string;
  customerRef?: string | null;
  externalId?: string | null;
}

// Sources accepted from user-facing import. product_text and product_tags are
// reserved for Shopify catalog sync and must never be accepted from user input.
export const VALID_IMPORT_SOURCES = ["manual", "csv", "chat", "email", "order_note"] as const;
export type ValidImportSource = (typeof VALID_IMPORT_SOURCES)[number];

export function sanitizeImportSource(raw: string): ValidImportSource {
  return VALID_IMPORT_SOURCES.includes(raw as ValidImportSource) ? (raw as ValidImportSource) : "manual";
}

export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function columnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header.trim().toLowerCase()));
}

export function parseImport(
  raw: string,
  opts: { source?: string; now?: Date } = {},
): ParsedMessage[] {
  const now = opts.now ?? new Date();
  const rows = parseCsv(raw).filter((row) => row.some((value) => value.trim()));
  const headers = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const contentIndex = columnIndex(headers, ["content", "message", "note", "body", "text"]);
  const dateIndex = columnIndex(headers, ["date", "created_at", "occurred_at"]);
  const customerIndex = columnIndex(headers, ["email", "customer"]);

  if (rows.length > 1 && contentIndex >= 0) {
    return rows.slice(1).flatMap((row) => {
      const content = row[contentIndex]?.trim();
      if (!content) return [];
      return {
        content,
        occurredAt: dateIndex >= 0 && row[dateIndex] ? new Date(row[dateIndex]) : now,
        source: opts.source ?? "csv",
        customerRef: customerIndex >= 0 ? row[customerIndex]?.trim() || null : null,
      };
    });
  }

  return raw
    .split(/\n\s*\n|\r?\n/)
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content) => ({
      content,
      occurredAt: now,
      source: opts.source ?? "manual",
      customerRef: null,
    }));
}

export function toNormalizedMessages(
  parsed: ParsedMessage[],
  idPrefix = "import",
): NormalizedMessage[] {
  return parsed.map((message, index) => ({
    id: `${idPrefix}-${index + 1}`,
    content: message.content,
    occurredAt: message.occurredAt,
    source: message.source,
    customerRef: message.customerRef,
    externalId: message.externalId,
  }));
}
