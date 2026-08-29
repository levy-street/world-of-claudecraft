// Server code resolves mail state through the Sim facade, never by reaching
// into sim.postOffice: the Sim delegate (Sim.hasCustodyParcel) exists precisely
// so foreign callers stay off the PostOffice internals, and this exact drift
// has already shipped once (server/woc_market_custody.ts read
// sim.postOffice.hasCustodyParcel BESIDE a line that already used the facade;
// fixed in the woc marketplace baseline). A source scan, because the drift is
// behaviorally invisible: the facade is a bare delegation, so both spellings
// pass every behavior test and only the seam discipline is lost.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('server stays off sim.postOffice (the Sim mail facade)', () => {
  const files = tsFilesUnder(fileURLToPath(new URL('../server', import.meta.url)));

  it('walks a real corpus and audits its own reads', () => {
    // Vacuity floor near the real count (tests/CLAUDE.md): server/ holds the
    // game server plus the http/epic/steam/parse/email subtrees, so a scan
    // that suddenly sees a fraction of that lost its recursion, not its work.
    expect(files.length).toBeGreaterThan(200);
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('no server file reaches into sim.postOffice', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f.full, 'utf8'));
      // EVERY spelling: member access, destructures, aliases (the bare-word
      // scan), plus the single-element bracket form checked FIRST because the
      // quoted carve-out below would hide it. The only sanctioned occurrence
      // is the bare quoted profiler lap-name string (server/game.ts), which is
      // a label, not a reach, and is removed before the bare-word scan.
      const bracketReach = /\[\s*['"`]postOffice['"`]\s*\]/.test(code);
      const scannable = code.replace(/['"`]postOffice['"`]/g, '');
      if (bracketReach || /\bpostOffice\b/.test(scannable)) {
        offenders.push(f.file);
      }
    }
    expect(
      offenders,
      'server file(s) reaching into sim.postOffice: resolve through the Sim ' +
        'facade instead (Sim.hasCustodyParcel / Sim.mailSystemParcel are the pattern):\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('the facade alternative is LIVE, so the absence above pins a real choice', () => {
    // Dead-alternate protection: the no-reach rule only means something while
    // the facade member exists and the custody bridge actually calls it.
    const sim = stripComments(
      readFileSync(fileURLToPath(new URL('../src/sim/sim.ts', import.meta.url)), 'utf8'),
    );
    expect(sim).toContain('hasCustodyParcel(custodyRef: string): boolean');
    const custody = stripComments(
      readFileSync(
        fileURLToPath(new URL('../server/woc_market_custody.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(custody).toContain('host.sim.hasCustodyParcel(custodyRef)');
  });
});
