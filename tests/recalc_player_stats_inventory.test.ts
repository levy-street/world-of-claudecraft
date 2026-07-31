import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// recalcPlayerStats takes the carried inventory so it can fold charm affixes
// (src/sim/charms.ts). The parameter is OPTIONAL with a `[]` default, which is
// what keeps the existing unit tests and characterDerivedStats callers compiling
// -- and is exactly why this guard exists: a call site that forgets the argument
// still type-checks and still runs, it just silently derives stats as though the
// player were carrying no charms. The bug would surface as a bonus that blinks
// off whenever some unrelated system happened to recalc (an aura expiring, a
// level-up, a form shift), which no single behavioral test would reliably catch.
//
// So the contract is pinned structurally instead: every call in src/ passes the
// sixth argument. A new recalc site fails here until it does.

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'src');

// The one sanctioned caller that forwards its OWN optional parameter rather than
// a live meta.inventory: characterDerivedStats builds a throwaway entity for the
// offline character sheet and passes `inventory ?? []` straight through.
const FORWARDING_CALLERS = new Set(['src/sim/entity.ts']);

interface CallSite {
  file: string;
  line: number;
  argCount: number;
  text: string;
}

function recalcCallSites(): CallSite[] {
  const out: CallSite[] = [];
  for (const { file, full } of tsFilesUnder(srcRoot)) {
    const source = ts.createSourceFile(
      full,
      ts.sys.readFile(full) ?? '',
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'recalcPlayerStats'
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        out.push({
          file: `src/${file}`,
          line: line + 1,
          argCount: node.arguments.length,
          text: node.getText(source).replace(/\s+/g, ' ').slice(0, 100),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

describe('every recalcPlayerStats call passes the carried inventory', () => {
  const sites = recalcCallSites();

  it('finds the call sites at all (non-vacuity)', () => {
    // A regex/AST change that stopped matching would make every assertion below
    // pass over an empty list. The floor is well under the real count so it does
    // not churn, but far enough above zero to prove the walk reached src/sim.
    expect(sites.length).toBeGreaterThan(20);
    expect(sites.some((s) => s.file === 'src/sim/entity.ts')).toBe(true);
    expect(sites.some((s) => s.file.startsWith('src/sim/combat/'))).toBe(true);
  });

  it('passes six arguments at every call site', () => {
    const short = sites
      .filter((s) => s.argCount < 6)
      .map((s) => `${s.file}:${s.line} (${s.argCount} args) ${s.text}`);
    expect(
      short,
      `recalcPlayerStats calls missing the inventory argument:\n${short.join('\n')}`,
    ).toEqual([]);
  });

  it('passes a real inventory, not an empty literal that would fake the count', () => {
    // Six arguments is only half the contract: `meta.inventory` is the point, and
    // a literal `[]` would satisfy an arity check while dropping every charm.
    const faked = sites
      .filter((s) => !FORWARDING_CALLERS.has(s.file))
      .filter((s) => /,\s*\[\s*\]\s*\)/.test(s.text))
      .map((s) => `${s.file}:${s.line} ${s.text}`);
    expect(
      faked,
      `recalcPlayerStats calls passing an empty inventory:\n${faked.join('\n')}`,
    ).toEqual([]);
  });

  it('reads src/ only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
