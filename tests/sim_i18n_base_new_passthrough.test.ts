// The sim DICT's BASE_NEW passthrough guard (Phase 18).
//
// BASE_DICT in src/ui/sim_i18n.ts spreads the whole `...BASE_NEW` table, then
// RE-DECLARES a block for each of the same eight locales underneath it. A
// re-declared key replaces the spread one outright, so each of those blocks must
// begin with its own inner `...BASE_NEW.<lang>` spread or every BASE_NEW fill for
// that locale is thrown away. Nothing about that failure is loud: `tSim` falls
// back to `DICT.en[key]`, so the row renders correct ENGLISH prose to a player on
// a non-English client, and every count-based i18n gate stays green because the
// key is present in the catalog and filled in the overlays. A QA pass verified by
// hand that all eight blocks carried their spread; this is that check made
// durable.
//
// Two arms, because neither one alone is decisive. The RUNTIME arm reads what a
// player would actually see and so catches a lost spread however it happens (a
// deleted line, a block moved above the `...BASE_NEW` spread, a locale re-declared
// somewhere new). The SOURCE arm covers the case the runtime arm cannot see yet: a
// locale whose block exists but for which BASE_NEW carries no rows, where a missing
// spread is invisible until the first fill lands in it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICT } from '../src/ui/sim_i18n';
import {
  ARENA_NEW,
  BASE_NEW,
  ITEM_NEW,
  PET_NEW,
  QUEST_NEW,
  RAID_NEW,
} from '../src/ui/sim_i18n.newlocales';

const SRC = path.resolve(process.cwd(), 'src/ui/sim_i18n.ts');
const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

const BASE_NEW_LOCALES = Object.keys(BASE_NEW);
const dict = DICT as unknown as Record<string, Record<string, string>>;

// Every top-level entry of the object literal a spread line sits in, as
// { name, startLine, endLine } over 1-based line numbers. Depth-tracked rather
// than regex-sliced: a locale block is thousands of lines of nested prose and
// only brace balance can say where one ends.
function topLevelBlocksAfter(spreadLine: number): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  let depth = 0;
  let open: { name: string; start: number } | null = null;
  for (let i = spreadLine; i < lines.length; i++) {
    const line = lines[i];
    if (depth === 0) {
      // The object literal itself closes at column 0; stop there.
      if (/^\};/.test(line)) break;
      const m = /^ {2}([A-Za-z_][A-Za-z0-9_]*): \{\s*$/.exec(line);
      if (m) {
        open = { name: m[1], start: i + 1 };
        depth = 1;
        continue;
      }
      continue;
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && open) {
      out.push({ name: open.name, start: open.start, end: i + 1 });
      open = null;
    }
  }
  return out;
}

function spreadLineOf(token: string): number {
  const idx = lines.findIndex((l) => l.trim() === `...${token},`);
  expect(idx, `sim_i18n.ts must spread ...${token}`).toBeGreaterThan(-1);
  return idx + 1;
}

describe('BASE_NEW fills survive the locale blocks re-declared under them', () => {
  it('covers the whole BASE_NEW table, not a sample', () => {
    // Vacuity floor. Every assertion below iterates a derived list, and an empty
    // one would pass silently; pin both dimensions near the real shape (8 locales,
    // 295 to 300 rows each today).
    expect(BASE_NEW_LOCALES.length).toBeGreaterThanOrEqual(8);
    for (const lang of BASE_NEW_LOCALES) {
      const rows = Object.keys((BASE_NEW as Record<string, Record<string, string>>)[lang]);
      expect(rows.length, `${lang} BASE_NEW rows`).toBeGreaterThan(250);
      expect(dict[lang], `DICT has no ${lang} table`).toBeTruthy();
    }
  });

  it('no BASE_NEW row renders English through the assembled DICT', () => {
    // The decisive arm. A block that lost its inner spread loses every BASE_NEW
    // row to the English base table, so the row a player reads equals DICT.en's.
    // Compared against DICT.en rather than against BASE_NEW itself because a block
    // may legitimately RE-word a BASE_NEW row after the spread (all seven live
    // cases are error.nothingToConsume); an override is fine, a fall back to
    // English is the defect.
    const passthrough: string[] = [];
    let checked = 0;
    for (const lang of BASE_NEW_LOCALES) {
      const rows = (BASE_NEW as Record<string, Record<string, string>>)[lang];
      for (const [key, fill] of Object.entries(rows)) {
        // A fill that IS the English string carries no information either way
        // (brand names, punctuation-only values); it cannot evidence a lost spread.
        if (fill === dict.en[key]) continue;
        checked++;
        if (dict[lang][key] === dict.en[key]) passthrough.push(`${lang} ${key}: ${dict.en[key]}`);
      }
    }
    expect(checked, 'no BASE_NEW row differed from English: the arm is vacuous').toBeGreaterThan(
      2000,
    );
    expect(passthrough, JSON.stringify(passthrough.slice(0, 10), null, 2)).toEqual([]);
  });

  it('every locale block re-declared under ...BASE_NEW spreads its own arm back in', () => {
    // The source arm, for the locale BASE_NEW does not fill yet: a block with no
    // rows to lose passes the runtime arm vacuously, and stays wrong the day its
    // first fill lands.
    const spread = spreadLineOf('BASE_NEW');
    const blocks = topLevelBlocksAfter(spread);
    const redeclared = blocks.filter((b) => BASE_NEW_LOCALES.includes(b.name));
    expect(
      redeclared.map((b) => b.name).sort(),
      'the re-declared blocks under ...BASE_NEW',
    ).toEqual([...BASE_NEW_LOCALES].sort());
    for (const block of redeclared) {
      const body = lines.slice(block.start, block.end - 1);
      const inner = body.filter((l) => l.trim() === `...BASE_NEW.${block.name},`);
      expect(
        inner.length,
        `${block.name} block (sim_i18n.ts:${block.start}-${block.end}) must spread ...BASE_NEW.${block.name} exactly once`,
      ).toBe(1);
    }
  });

  it('the sibling NEW tables are still spread with nothing re-declared under them', () => {
    // PET_NEW and its four siblings are spread into their own tables with no
    // locale re-declared afterwards, which is the whole reason only BASE_NEW needs
    // the inner-spread rule. Pin that premise: the day one of them grows a block
    // underneath, this fails and the rule above has to be extended to it rather
    // than the shadowing shipping unnoticed.
    const siblings = { PET_NEW, ARENA_NEW, QUEST_NEW, ITEM_NEW, RAID_NEW };
    for (const [name, table] of Object.entries(siblings)) {
      const locales = Object.keys(table);
      expect(locales.length, `${name} locales`).toBeGreaterThanOrEqual(8);
      const shadowed = topLevelBlocksAfter(spreadLineOf(name))
        .filter((b) => locales.includes(b.name))
        .map((b) => `${b.name} at sim_i18n.ts:${b.start}`);
      expect(shadowed, `${name} is shadowed by a re-declared locale block`).toEqual([]);
    }
  });
});
