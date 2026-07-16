import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { TranslationKey } from '../src/ui/i18n.catalog';

// Successor to the retired tests/i18n_overlay_key_membership.test.ts "teeth"
// self-checks. The membership guarantee itself moved to tsc: every overlay is
// typed Partial<Record<TranslationKey, string>> against the generated flat
// union (src/ui/i18n.catalog/translation_keys.generated.ts), which enforces
// strictly more than the old runtime test did. What the retirement lost was the
// CHECKED-IN proof that the guard is not vacuous. This file restores it in two
// halves: type-level probes compiled by `npx tsc --noEmit` (the gate, the
// pre-push floor, CI check:types, and editors), and runtime pins for the two
// legs the type probes cannot see (per-file annotations and the artifact's
// line-item shape, decision D6 in docs/toolchain-modernization/state.md).

// Anti-vacuity pin: if TranslationKey ever absorbs `string` (e.g. the generator
// gains a widening member like `| (string & {})`), the conditional type below
// collapses to `never` and this assignment is a compile error.
const unionIsNotVacuous: string extends TranslationKey ? never : true = true;
void unionIsNotVacuous;

// One bogus key per object literal: tsc reports only the FIRST excess property
// of each literal, so sharing one object would leave later directives unused.
// If the union stops rejecting any of these, the directive itself fails the
// build with TS2578 (unused @ts-expect-error). These are the same three
// synthetic probes the retired test asserted.
const inventedKey: Partial<Record<TranslationKey, string>> = {
  // @ts-expect-error a wholly invented dotted key must not typecheck
  'this.key.does.not.exist.in.en': 'x',
};
const typodEntityId: Partial<Record<TranslationKey, string>> = {
  // @ts-expect-error a typo'd entity id must not typecheck (the old pattern-member hole)
  'entities.abilities.firebal.name': 'x',
};
const nearMissSeparator: Partial<Record<TranslationKey, string>> = {
  // @ts-expect-error a near-miss separator must not typecheck
  'entities_abilities.fireball.name': 'x',
};
const nonStringValue: Partial<Record<TranslationKey, string>> = {
  // @ts-expect-error an overlay value must be a string
  'a11y.characterActions': 42,
};
void inventedKey;
void typodEntityId;
void nearMissSeparator;
void nonStringValue;

// Positive control: a real leaf key with a string value needs no directive.
const realKey: Partial<Record<TranslationKey, string>> = {
  'a11y.characterActions': 'x',
};
void realKey;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'src/ui/i18n.locales');
const keysPath = path.join(root, 'src/ui/i18n.catalog/translation_keys.generated.ts');

describe('overlay typing teeth', () => {
  it('every locale overlay declares the Partial<Record<TranslationKey, string>> annotation', () => {
    // The annotation is what routes each overlay through the excess-property
    // check against the flat union; a merge that drops or widens one silences
    // tsc for that overlay while every other gate stays green.
    const files = readdirSync(localesDir)
      .filter((f) => f.endsWith('.ts'))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(path.join(localesDir, f), 'utf8');
      expect(src, `${f} must be typed against the flat union`).toMatch(
        /: Partial<Record<TranslationKey, string>> =/,
      );
    }
  });
});

describe('generated key union line-item shape (decision D6)', () => {
  it('is sorted, unique, one quoted literal per line, no widening member, no metadata', () => {
    const lines = readFileSync(keysPath, 'utf8').split('\n');
    const memberRe = /^ {2}\| '([^'\\`]+)'(;?)$/;
    const keys: string[] = [];
    let exportLines = 0;
    let terminated = false;
    for (const line of lines) {
      if (exportLines === 0) {
        if (line === '') continue;
        if (line.startsWith('//')) {
          // D6: no count, hash, or timestamp anywhere in the file. A key count
          // or year is a 4+ digit run; a content hash is a long hex run.
          expect(line, 'header comment must carry no count or timestamp').not.toMatch(/\b\d{4,}\b/);
          expect(line, 'header comment must carry no hash').not.toMatch(/\b[0-9a-f]{12,}\b/i);
          continue;
        }
        expect(line).toBe('export type TranslationKeyFlat =');
        exportLines = 1;
        continue;
      }
      if (line === '') {
        // Only the trailing newline after the terminating member is allowed.
        expect(terminated, 'blank line before the terminating member').toBe(true);
        continue;
      }
      expect(terminated, `content after the terminating member: ${JSON.stringify(line)}`).toBe(
        false,
      );
      const m = memberRe.exec(line);
      // Any non-matching line here is a widening member (`| string`, a template
      // literal) or stray metadata: exactly what the teeth exist to catch.
      expect(m, `not a one-key-per-line union member: ${JSON.stringify(line)}`).not.toBeNull();
      const [, key, semi] = m as RegExpExecArray;
      keys.push(key);
      if (semi === ';') terminated = true;
    }
    expect(exportLines, 'missing the export type TranslationKeyFlat line').toBe(1);
    expect(terminated, 'missing the terminating semicolon member').toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    for (let i = 1; i < keys.length; i++) {
      // Strict ascending code-point order also guarantees uniqueness; sorted
      // line-item emit is what keeps the artifact merge-benign (D6).
      expect(keys[i] > keys[i - 1], `out of order or duplicate at ${keys[i]}`).toBe(true);
    }
  });
});
