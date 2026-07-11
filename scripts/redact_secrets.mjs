// Scrub credential-shaped substrings out of text that is about to become PUBLIC, for
// example a structured AI review before it becomes a public PR comment. Model output
// is untrusted even when the prompt and filesystem are isolated, so this scrubber is
// the last line of defense before text leaves the workflow.
//
// Deliberately conservative: only well-known credential shapes plus caller-supplied
// exact literals are redacted. There is deliberately NO generic long-hex rule, because
// git commit shas are legitimate and common in a code review comment.
//
// Pure and dependency-free so tests import it directly (tests/redact_secrets.test.ts,
// typed via the scripts/*.d.mts convention).

const REDACTED = '[redacted]';

// Exact extra literals shorter than this are ignored: too short to be a credential and
// too likely to blank out ordinary prose.
const MIN_LITERAL_LENGTH = 8;

// Well-known credential shapes. Every pattern carries the /g flag so each occurrence
// is replaced, and a leading \b so a match never starts inside a longer word (keeps
// hyphenated prose like "task-..." out of the sk- rule).
const SECRET_PATTERNS = [
  // GitHub classic prefixed tokens: personal (ghp), OAuth (gho), user-to-server (ghu),
  // server-to-server / Actions (ghs), refresh (ghr); 36+ base62 chars after the prefix.
  /\bgh[opusr]_[A-Za-z0-9]{36,255}/g,
  // GitHub fine-grained personal access tokens.
  /\bgithub_pat_[A-Za-z0-9_]{22,255}/g,
  // OpenAI-style API keys (sk-..., including sk-proj-...).
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // Signed JWTs: an eyJ header plus two more dot-separated base64url segments.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
];

// Replace credential-shaped substrings, and any exact literal from extraLiterals of
// length >= MIN_LITERAL_LENGTH regardless of shape, with [redacted]. Returns a new
// { text, redactedCount } and never mutates its arguments.
export function redactSecrets(text, extraLiterals = []) {
  let out = String(text ?? '');
  let redactedCount = 0;

  // Exact literals first: the caller knows these are secrets whatever their shape.
  for (const literal of extraLiterals) {
    if (typeof literal !== 'string' || literal.length < MIN_LITERAL_LENGTH) continue;
    const parts = out.split(literal);
    redactedCount += parts.length - 1;
    out = parts.join(REDACTED);
  }

  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      redactedCount += 1;
      return REDACTED;
    });
  }

  return { text: out, redactedCount };
}
