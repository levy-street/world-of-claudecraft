// Static pre-screen for submitted plugin source: a high-recall, reviewer-facing
// flag list in the spirit of scripts/malware_scan.mjs, run at submit time and
// stored with the pending version so the admin review queue can surface what a
// reviewer must look at first. It is DELIBERATELY not a gate and not a sandbox:
// approval stays a human decision (docs/prd/plugins-store.md, Threat model),
// and a flag here is a reading assignment, not a verdict. Pure module: no SQL,
// no HTTP, no IO, unit-tested directly (tests/server/plugin_screen.test.ts).

/** One reviewer-facing finding: a stable code plus the 1-based source line. */
export interface PluginScreenFlag {
  /** Stable machine code; the admin dashboard maps codes to localized labels. */
  readonly code: PluginScreenCode;
  /** 1-based line of the first match for this code. */
  readonly line: number;
}

export type PluginScreenCode =
  | 'dynamic-code'
  | 'network'
  | 'browser-storage'
  | 'global-dom'
  | 'credential-text'
  | 'obfuscation';

interface ScreenRule {
  readonly code: PluginScreenCode;
  readonly pattern: RegExp;
}

// Order is display order in the review queue: the scarier classes first. Each
// pattern is intentionally broad (high recall); false positives cost a reviewer
// a glance, a false negative costs a player. Word boundaries keep identifiers
// like `prefetch` or `windowSeconds` from tripping the network/dom rules.
const RULES: readonly ScreenRule[] = [
  // eval / Function constructors / dynamic import / script injection / workers.
  {
    code: 'dynamic-code',
    pattern:
      /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(\s*['"`]|\bimport\s*\(|createElement\s*\(\s*['"`]script['"`]\)|\bnew\s+Worker\b/,
  },
  // Any network egress surface. Plugins have no sanctioned network API; the
  // review guideline is that a plugin talking to the network needs a written
  // justification in its submission notes.
  {
    code: 'network',
    pattern:
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bsendBeacon\b|\bEventSource\b|\bnavigator\.serviceWorker\b/,
  },
  // Direct browser storage instead of the namespaced, size-capped woc.storage.
  {
    code: 'browser-storage',
    pattern: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/,
  },
  // Reaching around the plugin panel into the page. woc.ui panels are the
  // sanctioned DOM surface; global document/window access can read the token
  // prompt, move HUD frames, or fake chrome.
  {
    code: 'global-dom',
    pattern: /\bdocument\s*\.|\bwindow\s*\.|\bglobalThis\s*\.|\btop\s*\.\s*location\b/,
  },
  // Credential-shaped string literals: a plugin has no business naming these.
  {
    code: 'credential-text',
    pattern: /['"`](?:authorization|bearer|password|auth[_-]?token|api[_-]?key)['"`]/i,
  },
  // Decoder chains and hex/unicode escape walls that hide what the code does.
  {
    code: 'obfuscation',
    pattern:
      /\batob\s*\(|\bString\.fromCharCode\b|(?:\\x[0-9a-fA-F]{2}){8,}|(?:\\u[0-9a-fA-F]{4}){8,}/,
  },
];

// A single physical line this long is itself an obfuscation smell (minified or
// packed payloads); flagged with the obfuscation code.
const OBFUSCATION_LINE_LENGTH = 1000;

/**
 * Screen plugin source and return every triggered flag (at most one per code,
 * anchored to the first matching line). An empty result means "nothing for the
 * reviewer to jump to", never "safe".
 */
export function screenPluginSource(source: string): PluginScreenFlag[] {
  const lines = source.split('\n');
  const flags: PluginScreenFlag[] = [];
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        flags.push({ code: rule.code, line: i + 1 });
        break;
      }
    }
  }
  if (!flags.some((flag) => flag.code === 'obfuscation')) {
    const longLine = lines.findIndex((line) => line.length >= OBFUSCATION_LINE_LENGTH);
    if (longLine !== -1) flags.push({ code: 'obfuscation', line: longLine + 1 });
  }
  return flags;
}

/** Decode a stored screen JSONB value back into flags, dropping malformed rows. */
export function decodeScreenFlags(raw: unknown): PluginScreenFlag[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginScreenFlag[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const code = (row as { code?: unknown }).code;
    const line = (row as { line?: unknown }).line;
    if (typeof code !== 'string' || !Number.isInteger(line)) continue;
    if (!RULES.some((rule) => rule.code === code)) continue;
    out.push({ code: code as PluginScreenCode, line: line as number });
  }
  return out;
}
