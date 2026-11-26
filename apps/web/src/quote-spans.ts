type QuoteContext = {
  text: string;
  surroundingWords?:
    { before?: string | undefined; after?: string | undefined } | undefined;
};

export function selectionQuote(article: string, start: number, end: number) {
  const text = article.slice(start, end);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > article.length ||
    start >= end ||
    !text.trim()
  )
    throw new RangeError("Select nonempty article text.");
  return {
    text,
    surroundingWords: {
      before: article.slice(Math.max(0, start - 120), start),
      after: article.slice(end, end + 120),
    },
  };
}

export function findExactQuoteSpan(article: string, quote: QuoteContext) {
  if (!quote.text) return undefined;
  const matches = [];
  const contextual = [];
  const before = quote.surroundingWords?.before ?? "";
  const after = quote.surroundingWords?.after ?? "";
  for (
    let start = article.indexOf(quote.text);
    start !== -1;
    start = article.indexOf(quote.text, start + 1)
  ) {
    const end = start + quote.text.length;
    const span = { start, end };
    matches.push(span);
    if (
      article.slice(0, start).endsWith(before) &&
      article.startsWith(after, end)
    )
      contextual.push(span);
    if (contextual.length > 1) return undefined;
  }
  return contextual.length === 1
    ? contextual[0]
    : matches.length === 1
      ? matches[0]
      : undefined;
}

export function readArticleSelection(article: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (
    !article.contains(range.startContainer) ||
    !article.contains(range.endContainer)
  )
    return undefined;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(article);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const end = start + range.toString().length;
  if (!text.slice(start, end).trim()) return undefined;
  return selectionQuote(text, start, end);
}
