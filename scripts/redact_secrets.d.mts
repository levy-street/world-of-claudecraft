// Type surface for the public-output credential scrubber (see redact_secrets.mjs).
// Mirrors the scripts/*.d.mts convention so tests can import the .mjs under strict
// tsc without an implicit-any error.

export interface RedactResult {
  // The input with every credential-shaped match replaced by "[redacted]".
  text: string;
  // How many replacements were made; 0 means the text came back unchanged.
  redactedCount: number;
}

// Replace credential-shaped substrings (GitHub token prefixes ghp_/gho_/ghu_/ghs_/
// ghr_/github_pat_, OpenAI-style sk- keys, signed JWTs, AWS AKIA ids) and any exact
// extraLiterals entry of length >= 8 (regardless of shape; null/undefined entries are
// skipped) with "[redacted]". Conservative by design: no generic long-hex rule, so
// git shas survive.
export function redactSecrets(
  text: string,
  extraLiterals?: readonly (string | null | undefined)[],
): RedactResult;
