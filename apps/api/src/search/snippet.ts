const defaultMaxLength = 200;
const leadIn = 60;

/**
 * A long message is shown as a window around the earliest match, so a result
 * row never becomes the whole message. The snippet always contains the term it
 * was cut around, which is what the browser highlights.
 */
export function messageSnippet(
  text: string,
  terms: readonly string[],
  maxLength: number = defaultMaxLength,
): string {
  if (text.length <= maxLength) {
    return text;
  }

  const lower = text.toLowerCase();
  let matchAt = -1;

  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());

    if (index >= 0 && (matchAt < 0 || index < matchAt)) {
      matchAt = index;
    }
  }

  const start = matchAt < 0 ? 0 : Math.max(0, matchAt - leadIn);
  const end = Math.min(text.length, start + maxLength);

  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
    end < text.length ? "…" : ""
  }`;
}
