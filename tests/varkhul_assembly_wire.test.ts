import { describe, expect, it } from 'vitest';
import {
  decodeVarkhulAnvilMeteors,
  decodeVarkhulAssemblies,
} from '../src/net/varkhul_assembly_wire';

function runeRows(overrides: Record<number, Record<string, unknown>> = {}) {
  return Array.from({ length: 10 }, (_, symbol) => ({
    sym: symbol,
    x: symbol * 2,
    z: symbol * -3,
    r: 3.3,
    ti: symbol,
    tr: 3,
    oa: Math.PI / 10 + (symbol * Math.PI) / 5,
    ta: symbol * 0.2,
    ga: symbol * 0.2 + 0.4,
    c: symbol === 2 ? 1 : symbol === 3 ? 2 : 0,
    cp: symbol === 2 ? 0.5 : 0,
    ap: symbol === 1 ? 1 : 0,
    al: 0,
    lock: symbol === 1 ? 1 : 0,
    or: symbol === 2 ? 1 : 0,
    ...overrides[symbol],
  }));
}

function assemblyRow(overrides: Record<string, unknown> = {}) {
  return {
    bossId: 7,
    hc: 1,
    phase: 'links',
    fx: 10,
    fz: 20,
    hp: 0,
    mhp: 100,
    oh: 0.35,
    bw: 0,
    mr: 0,
    aw: 2,
    aws: 4,
    ar: 7,
    beams: [
      { i: 0, cx: -18, cz: 20, ix: -8, iz: 20, bid: 4 },
      { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, bid: null },
    ],
    ib: null,
    win: 0,
    round: 0,
    rounds: 2,
    rem: 24,
    cores: [{ id: 'core', x: 1, z: 2, cid: null, del: 1 }],
    assign: [
      { pid: 4, sym: 2, lock: 0 },
      { pid: 5, sym: 1, lock: 1 },
    ],
    runes: runeRows(),
    ...overrides,
  };
}

describe('Varkhul assembly wire', () => {
  it('decodes the permanent dormant pillars before combat', () => {
    const decoded = decodeVarkhulAssemblies([
      assemblyRow({
        hc: 0,
        phase: 'idle',
        bm: 0,
        oh: 0,
        beams: [
          { i: 0, cx: -18, cz: 20, ix: 10, iz: 20, a: 0, w: 0, bid: null },
          { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, a: 0, w: 1, bid: null },
        ],
        cores: [],
        assign: [],
        runes: [],
        round: 0,
        rounds: 1,
        rem: 0,
      }),
    ]);

    expect(decoded).toEqual([
      expect.objectContaining({
        difficulty: 'normal',
        phase: 'idle',
        forgeBeamActiveMask: 0,
        forgeBeams: [
          expect.objectContaining({ index: 0, active: false, warning: false, blocked: false }),
          expect.objectContaining({ index: 1, active: false, warning: true, blocked: false }),
        ],
        assignments: [],
        runes: [],
      }),
    ]);
  });

  it('preserves non-zero beam warmup and meltdown windows', () => {
    expect(decodeVarkhulAssemblies([assemblyRow({ bw: 2.35 })])[0]).toMatchObject({
      phase: 'links',
      forgeBeamWarmupRemaining: 2.35,
      forgeMeltdownRemaining: 0,
      addWave: 2,
      addWaves: 4,
      addsRemaining: 7,
    });
    expect(
      decodeVarkhulAssemblies([assemblyRow({ phase: 'done', beams: [], bw: 0, mr: 4.5 })])[0],
    ).toMatchObject({
      phase: 'done',
      forgeBeamWarmupRemaining: 0,
      forgeMeltdownRemaining: 4.5,
      forgeBeams: [],
    });
  });

  it('accepts legacy missing wave progress and rejects malformed counters', () => {
    const { aw: _aw, aws: _aws, ar: _ar, ...legacy } = assemblyRow();
    expect(decodeVarkhulAssemblies([legacy])[0]).toMatchObject({
      addWave: 0,
      addWaves: 0,
      addsRemaining: 0,
    });
    for (const invalid of [
      { aw: -1 },
      { aw: 1.5 },
      { aw: 5, aws: 4 },
      { aws: -1 },
      { aws: Number.POSITIVE_INFINITY },
      { ar: -1 },
      { ar: 2.5 },
    ]) {
      expect(decodeVarkhulAssemblies([assemblyRow(invalid)])).toEqual([]);
    }
  });

  it('defaults legacy beam warnings off and rejects malformed warning flags', () => {
    expect(decodeVarkhulAssemblies([assemblyRow()])[0]?.forgeBeams).toEqual([
      expect.objectContaining({ index: 0, warning: false }),
      expect.objectContaining({ index: 1, warning: false }),
    ]);
    const malformed = assemblyRow({
      beams: [
        { i: 0, cx: -18, cz: 20, ix: -8, iz: 20, w: 2, bid: 4 },
        { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, w: 0, bid: null },
      ],
    });
    expect(decodeVarkhulAssemblies([malformed])).toEqual([]);
  });

  it('decodes the moving Tempering Ray and rejects every unsafe endpoint branch', () => {
    const ib = {
      sid: 7,
      tid: 12,
      bid: 4,
      sx: 1,
      sz: 2,
      tx: 18,
      tz: 20,
      bx: 8,
      bz: 11,
      w: 1.35,
      dur: 5,
      rem: 2.25,
    };
    expect(decodeVarkhulAssemblies([assemblyRow({ ib })])[0].interceptBeam).toEqual({
      sourceId: 7,
      targetId: 12,
      blockerId: 4,
      sourceX: 1,
      sourceZ: 2,
      targetX: 18,
      targetZ: 20,
      blockerX: 8,
      blockerZ: 11,
      width: 1.35,
      duration: 5,
      remaining: 2.25,
    });
    const unsafe: Record<string, unknown>[] = [
      { ...ib, bid: null },
      { ...ib, bid: null, bx: 8, bz: null },
      { ...ib, bid: null, bx: null, bz: 11 },
      { ...ib, bid: null, bx: null, bz: null, sx: Number.NaN },
      { ...ib, bid: null, bx: null, bz: null, tid: 7 },
      { ...ib, bid: 7 },
      { ...ib, bid: 12 },
      { ...ib, bx: null },
      { ...ib, bz: null },
      { ...ib, bx: Number.POSITIVE_INFINITY },
      { ...ib, sid: 8 },
      { ...ib, sid: -1 },
      { ...ib, tid: 1.5 },
      { ...ib, bid: -1 },
      { ...ib, w: 0 },
      { ...ib, w: 5.01 },
      { ...ib, dur: 0 },
      { ...ib, dur: 15.01 },
      { ...ib, rem: 0 },
      { ...ib, rem: 5.01 },
    ];
    for (const invalid of unsafe) {
      expect(decodeVarkhulAssemblies([assemblyRow({ ib: invalid })])).toEqual([]);
    }
  });

  it('decodes ten individual stations and both moving controls', () => {
    const decoded = decodeVarkhulAssemblies([assemblyRow()]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      bossId: 7,
      difficulty: 'heroic',
      phase: 'links',
      forgeX: 10,
      forgeZ: 20,
      forgeHp: 0,
      forgeMaxHp: 100,
      forgeOverheat: 0.35,
      forgeBeamWarmupRemaining: 0,
      forgeMeltdownRemaining: 0,
      assignments: [
        { playerId: 4, symbol: 2, locked: false },
        { playerId: 5, symbol: 1, locked: true },
      ],
    });
    expect(decoded[0].runes).toHaveLength(10);
    expect(decoded[0].forgeBeams).toEqual([
      {
        index: 0,
        columnX: -18,
        columnZ: 20,
        impactX: -8,
        impactZ: 20,
        active: true,
        warning: false,
        blocked: true,
        blockerId: 4,
      },
      {
        index: 1,
        columnX: 38,
        columnZ: 20,
        impactX: 10,
        impactZ: 20,
        active: true,
        warning: false,
        blocked: false,
        blockerId: null,
      },
    ]);
    expect(decoded[0].runes[1]).toMatchObject({
      symbol: 1,
      assignedPlayerId: 5,
      locked: true,
      trackIndex: 1,
      control: 'off',
      controlProgress: 0,
      alignmentProgress: 1,
      aligned: false,
    });
    expect(decoded[0].runes[1].trackRadius).toBeCloseTo(3, 8);
    expect(decoded[0].runes[1].targetAngle).toBeCloseTo(0.2, 8);
    expect(decoded[0].runes[1].glyphAngle).toBeCloseTo(0.6, 8);
    expect(decoded[0].runes[2]).toMatchObject({
      assignedPlayerId: 4,
      orphaned: true,
      control: 'counterclockwise',
      controlProgress: 0.5,
      aligned: false,
    });
    expect(decoded[0].runes[2].targetAngle).toBeCloseTo(0.4, 8);
    expect(decoded[0].runes[2].glyphAngle).toBeCloseTo(0.8, 8);
    expect(decoded[0].runes[3]).toMatchObject({ assignedPlayerId: null, control: 'clockwise' });
    expect(decoded[0].runes[3].orphaned).toBe(false);
  });

  it('drops the whole assembly for malformed, duplicate, incomplete, or inconsistent rune state', () => {
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 4: { sym: 10 } }) })])).toEqual(
      [],
    );
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 4: { sym: 3 } }) })])).toEqual(
      [],
    );
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows().slice(0, 9) })])).toEqual([]);
    expect(
      decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 2: { ga: Number.NaN } }) })]),
    ).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 2: { c: 3 } }) })])).toEqual(
      [],
    );
    expect(decodeVarkhulAssemblies([assemblyRow({ hc: 2 })])).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ oh: 1.01 })])).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ oh: -0.01 })])).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ bw: -0.01 })])).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ mr: -0.01 })])).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          beams: [
            { i: 2, cx: -18, cz: 20, ix: -8, iz: 20, bid: 4 },
            { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, bid: null },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          beams: [
            { i: 0, cx: Number.NaN, cz: 20, ix: -8, iz: 20, bid: 4 },
            { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, bid: null },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          beams: [
            { i: 0, cx: -18, cz: 20, ix: -8, iz: 20, bid: -1 },
            { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, bid: null },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ phase: 'done' })])).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({ beams: [{ i: 0, cx: -18, cz: 20, ix: -8, iz: 20, bid: 4 }] }),
      ]),
    ).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          beams: [
            { i: 0, cx: -18, cz: 20, ix: -8, iz: 20, bid: 4 },
            { i: 0, cx: 38, cz: 20, ix: 10, iz: 20, bid: null },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 2: { ti: 10 } }) })])).toEqual(
      [],
    );
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 2: { cp: 1.1 } }) })])).toEqual(
      [],
    );
    expect(decodeVarkhulAssemblies([assemblyRow({ runes: runeRows({ 2: { or: 2 } }) })])).toEqual(
      [],
    );
    expect(
      decodeVarkhulAssemblies([assemblyRow({ assign: [{ pid: 4, sym: 1, lock: 0 }] })]),
    ).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          assign: [
            { pid: 4, sym: 0, lock: 0 },
            { pid: 4, sym: 2, lock: 0 },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          assign: [
            { pid: 4, sym: 2, lock: 0 },
            { pid: 5, sym: 2, lock: 0 },
          ],
        }),
      ]),
    ).toEqual([]);
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({
          phase: 'convergence',
          beams: [],
          assign: [],
          runes: [...runeRows(), runeRows()[0]],
        }),
      ]),
    ).toEqual([]);
    expect(decodeVarkhulAssemblies([assemblyRow({ phase: 'future' })])).toEqual([]);
  });

  it('accepts convergence before symbols and rune rows are assigned', () => {
    expect(
      decodeVarkhulAssemblies([
        assemblyRow({ phase: 'convergence', beams: [], rem: 4, assign: [], runes: [] }),
      ]),
    ).toMatchObject([{ phase: 'convergence', remaining: 4, assignments: [], runes: [] }]);
  });

  it('defaults orphan state off for mixed-release snapshots without the new field', () => {
    const decoded = decodeVarkhulAssemblies([
      assemblyRow({ runes: runeRows({ 2: { or: undefined } }) }),
    ]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].runes[2].orphaned).toBe(false);
  });

  it('defaults moving-track fields and difficulty for mixed-release snapshots', () => {
    const legacyRunes = runeRows().map(
      ({ ti: _ti, tr: _tr, oa: _oa, cp: _cp, ap: _ap, ...rune }) => rune,
    );
    const decoded = decodeVarkhulAssemblies([
      assemblyRow({ hc: undefined, rounds: 1, runes: legacyRunes }),
    ]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].difficulty).toBe('normal');
    expect(decoded[0].runes[2]).toMatchObject({
      trackIndex: 2,
      trackRadius: 3.3,
      controlProgress: 1,
      alignmentProgress: 0,
    });
  });

  it('decodes meteor countdowns and drops invalid footprints', () => {
    expect(
      decodeVarkhulAnvilMeteors([
        { id: 'm', x: 1, z: 2, r: 3.5, dur: 1.8, rem: 1.2, lead: 0 },
        { id: 'bad', x: 1, z: 2, r: 0, dur: 1.8, rem: 1.2, lead: 0 },
      ]),
    ).toEqual([
      {
        id: 'm',
        x: 1,
        z: 2,
        radius: 3.5,
        duration: 1.8,
        remaining: 1.2,
        warningLead: 0,
      },
    ]);
  });
});
