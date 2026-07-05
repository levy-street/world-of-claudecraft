'use strict';

// Player-visible strings the MAIN process may need when the renderer is dead
// (the crash dialog) or dying. The main process has no i18n runtime, so the
// renderer PUSHES its t()-rendered translations over IPC at boot and on locale
// change ('desktop-set-strings', see src/game/desktop_shell_strings.ts); the
// English values below are only the fallback for the narrow window before the
// first push (a crash before the client booted far enough to localize
// anything). This mirrors the repo's sim/server rule: the emitter stays
// language-agnostic and the client supplies the localized text.
//
// Pure and Node-tested (tests/electron_shell_strings.test.ts): the sanitizer
// is the trust boundary for renderer-supplied text that later feeds native
// dialogs, so it drops unknown keys, non-strings, control characters, and
// over-long values.

const { flattenControlChars } = require('./diagnostics.cjs');

const DEFAULT_SHELL_STRINGS = {
  crashTitle: 'World of ClaudeCraft',
  crashBody: 'The game view stopped working. Reload it?',
  crashReload: 'Reload',
  crashQuit: 'Quit',
  fatalTitle: 'World of ClaudeCraft',
  fatalBody: 'World of ClaudeCraft hit an unexpected error and needs to close.',
};

const MAX_SHELL_STRING_LENGTH = 300;

// Merge a renderer-supplied strings object over `current`, accepting only the
// known keys with sane string values. Returns a NEW object; never throws.
function sanitizeShellStrings(input, current = DEFAULT_SHELL_STRINGS) {
  const merged = { ...current };
  if (!input || typeof input !== 'object') return merged;
  for (const key of Object.keys(DEFAULT_SHELL_STRINGS)) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    // Full C0/C1 control range, not just \r\n\t: these strings feed native
    // dialogs, so keep the same trust-boundary stripping the log path uses.
    const cleaned = flattenControlChars(value).trim();
    if (cleaned === '' || cleaned.length > MAX_SHELL_STRING_LENGTH) continue;
    merged[key] = cleaned;
  }
  return merged;
}

module.exports = { DEFAULT_SHELL_STRINGS, MAX_SHELL_STRING_LENGTH, sanitizeShellStrings };
