import { normalizeText } from "./normalize";
import { STOP_WORDS } from "./stopwords";

/** Tokenize normalized text with optional stopword removal. */
export function tokenize(
  text: string,
  opts: { removeStopWords?: boolean; minLength?: number } = {},
): string[] {
  const minLength = opts.minLength ?? 1;
  return normalizeText(text)
    .split(" ")
    .filter(
      (token) =>
        token.length >= minLength &&
        (!opts.removeStopWords || !STOP_WORDS.has(token)),
    );
}

/** Build space-joined n-grams from a token list. */
export function ngrams(tokens: string[], n: number): string[] {
  if (n <= 0 || tokens.length < n) return [];
  return tokens.slice(0, tokens.length - n + 1).map((_, index) => {
    return tokens.slice(index, index + n).join(" ");
  });
}
