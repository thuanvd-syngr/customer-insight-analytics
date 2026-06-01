/** Normalize text for deterministic keyword matching. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Split original text into sentence-like fragments for examples. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?:[.!?]+|\r?\n)+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
