// The shared bareClient fixture (tests/helpers/bare_client.ts) claims to
// mirror every field ClientWorld declares a static default for
// (Object.create skips the constructor, so class-field initializers never
// run). That claim was unenforced, and the release's playtimeSeconds class
// field landed without the fixture noticing (caught in the Phase 16 QA sync
// audit). This sweep reads the class-field declarations off the TypeScript
// AST (a regex scrape proved blind by SHAPE: callback-typed annotations
// contain `=>`, multi-line annotations cross lines, initializers wrap), so
// the next class field cannot drift the shared fixture silently, whatever
// its declaration looks like.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bareClient } from './helpers/bare_client';

interface ScrapedField {
  name: string;
  init: string;
}

function scrapeClientWorldFields(): ScrapedField[] {
  const file = join(__dirname, '../src/net/online.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const fields: ScrapedField[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'ClientWorld') {
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;
        if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
        // Bound listeners (arrow-function fields like handleVisibilityChange)
        // close over the constructor's wiring; no bare-client suite drives
        // them, so they are the one deliberate exclusion.
        if (ts.isArrowFunction(member.initializer)) continue;
        if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) continue;
        fields.push({ name: member.name.text, init: member.initializer.getText(sf) });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return fields;
}

/** The simple-literal initializers whose VALUE the sweep can assert exactly
 *  (presence alone would let `undefined` shadow a `null` default, which the
 *  guild-bank `!== null` gates distinguish). */
const LITERAL_VALUES: Record<string, unknown> = {
  null: null,
  undefined,
  '0': 0,
  '1': 1,
  false: false,
  true: true,
  "''": '',
  '-1': -1,
};

describe('bareClient mirrors ClientWorld class-field defaults', () => {
  const fields = scrapeClientWorldFields();
  const c = bareClient(1) as unknown as Record<string, unknown>;

  it('defines every field the class declares with an initializer', () => {
    expect(
      fields.length,
      'anti-vacuity: the AST scrape really found the field block',
    ).toBeGreaterThan(120);
    expect(
      fields.some((f) => f.name === 'playtimeSeconds'),
      'the field that motivated this sweep',
    ).toBe(true);
    expect(
      fields.some((f) => f.name === 'onDisconnect'),
      'a callback-typed field the retired regex scrape was blind to',
    ).toBe(true);
    const missing = fields.filter((f) => !(f.name in c)).map((f) => f.name);
    expect(
      missing,
      `bareClient is missing ClientWorld class-field defaults:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('matches the class initializer VALUE for every simple-literal default', () => {
    // The fixture's DOCUMENTED deliberate divergences (its own header
    // explains each): `connected` is true because the fixture feeds an
    // already-open session, and the two id fields carry the caller's pid
    // instead of the class's -1 sentinel. Everything else must equal the
    // class default exactly: presence alone would let an `undefined` shadow
    // a `null` default, which the guild-bank `!== null` gates distinguish.
    const INTENTIONAL = new Set(['connected', 'playerId', 'ownPlayerId']);
    let checked = 0;
    const wrong: string[] = [];
    for (const f of fields) {
      if (INTENTIONAL.has(f.name) || !Object.hasOwn(LITERAL_VALUES, f.init)) continue;
      checked += 1;
      if (!Object.is(c[f.name], LITERAL_VALUES[f.init])) {
        wrong.push(`${f.name}: class default ${f.init}, fixture has ${String(c[f.name])}`);
      }
    }
    expect(checked, 'anti-vacuity: the literal subset is really swept').toBeGreaterThan(60);
    expect(wrong, `fixture values that shadow the class default:\n${wrong.join('\n')}`).toEqual([]);
  });
});
