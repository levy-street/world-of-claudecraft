// Client-side cosmetic profanity masking for the chat log. The server ships the
// soft word list (in `hello` / `censor` frames) but never alters the text, so
// each client masks locally according to the player's "Filter Profanity"
// setting. This is display-only — slurs are blocked server-side and never get
// here, and a player who turns the filter off simply sees the raw text.
//
// The normalization MUST stay in lockstep with server/chat_filter.ts so the
// terms the server sends mask the same tokens the server intended. It's a tiny,
// stable function; the layering rules (ui/ can't import server/) make a small
// duplicate cleaner than a shared cross-boundary module.

const CONFUSABLE_CHARS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '!': 'i',
  '|': 'i',
  '@': 'a',
  '$': 's',
  '+': 't',
};

const TOKEN_RE = /[A-Za-z0-9_@$!|+]+/g;

function normalizeWord(term: string): string {
  return term
    .toLowerCase()
    .replace(/[0134578!|@$+]/g, (ch) => CONFUSABLE_CHARS[ch] ?? ch)
    .replace(/[^a-z]/g, '');
}

/** Replace every token containing a soft term with asterisks of equal length. */
export function maskProfanity(text: string, terms: readonly string[]): string {
  if (terms.length === 0) return text;
  return text.replace(TOKEN_RE, (tok) => {
    const normalized = normalizeWord(tok);
    return normalized.length > 0 && terms.some((term) => normalized.includes(term))
      ? '*'.repeat(tok.length)
      : tok;
  });
}
