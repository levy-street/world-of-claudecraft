import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { varkhulEncounterWireJson } from '../../server/varkhul_wire';
import { decodeVarkhulAssemblies } from '../../src/net/varkhul_assembly_wire';

describe('Varkhul snapshot wire fragment', () => {
  it('builds the realm projection once per broadcast before viewer filtering', () => {
    const gameSource = readFileSync(new URL('../../server/game.ts', import.meta.url), 'utf8');
    expect(gameSource).toMatch(/const telegraphWorld = groundTelegraphWorld\(this\.sim,/);
    const wireSource = readFileSync(
      new URL('../../server/ground_telegraph_wire.ts', import.meta.url),
      'utf8',
    );
    expect(wireSource).toMatch(/varkhulEncounter: \{[\s\S]*?activeVarkhulAssemblies/);
    expect(wireSource).toMatch(/varkhulEncounterWireJson\(\s*world\.varkhulEncounter,/);
  });

  it('interest-scopes every mechanic family and preserves stable compact fields', () => {
    const json = varkhulEncounterWireJson(
      {
        activeVarkhulForgestormWarnings: [
          {
            id: 'varkhul-forgestorm:1:1:0:0',
            sourceId: 1,
            x: 3.126,
            z: 4.234,
            radius: 4,
            duration: 2.5,
            remaining: 1.4,
            warningLead: 0,
          },
          {
            id: 'varkhul-forgestorm:1:1:0:1',
            sourceId: 1,
            x: 200,
            z: 4,
            radius: 4,
            duration: 2.5,
            remaining: 1,
            warningLead: 0,
          },
        ],
        activeVarkhulCinderFires: [
          { id: '1:cinder-fire:2:0', sourceId: 1, x: 5.126, z: 6.234, radius: 2.4 },
        ],
        activeVarkhulCinderOrbProjectiles: [],
        activeVarkhulAnvilMeteors: [],
        activeVarkhulAssemblies: [],
      },
      { x: 0, z: 0 },
      50,
    );
    expect(JSON.parse(`{${json.slice(1)}}`)).toEqual({
      varkhulForgestorm: [
        {
          id: 'varkhul-forgestorm:1:1:0:0',
          sourceId: 1,
          x: 3.13,
          z: 4.23,
          r: 4,
          dur: 2.5,
          rem: 1.4,
          lead: 0,
        },
      ],
      varkhulCinderFires: [{ id: '1:cinder-fire:2:0', sourceId: 1, x: 5.13, z: 6.23, r: 2.4 }],
    });
  });

  it('serializes ten ownership states over ten individual rune stations', () => {
    const runes = Array.from({ length: 10 }, (_, symbol) => ({
      symbol,
      x: symbol * 2.126,
      z: symbol * -3.234,
      radius: 3.3,
      trackIndex: symbol,
      trackRadius: 3,
      ownerAngle: Math.PI / 10 + (symbol * Math.PI) / 5,
      assignedPlayerId: symbol === 2 ? 9 : null,
      orphaned: symbol === 2,
      locked: symbol === 2,
      targetAngle: symbol * 0.2,
      glyphAngle: symbol * 0.2 + 0.4,
      control: symbol === 2 ? ('clockwise' as const) : ('off' as const),
      controlProgress: symbol === 2 ? 0.75 : 0,
      alignmentProgress: symbol === 2 ? 1 : 0,
      aligned: symbol === 2,
    }));
    const json = varkhulEncounterWireJson(
      {
        activeVarkhulForgestormWarnings: [],
        activeVarkhulCinderFires: [],
        activeVarkhulCinderOrbProjectiles: [],
        activeVarkhulAnvilMeteors: [],
        activeVarkhulAssemblies: [
          {
            bossId: 7,
            difficulty: 'heroic',
            phase: 'links',
            forgeX: 10,
            forgeZ: 20,
            forgeHp: 0,
            forgeMaxHp: 100,
            forgeOverheat: 0.42,
            forgeBeamActiveMask: 3,
            forgeBeamWarmupRemaining: 2.35,
            forgeMeltdownRemaining: 0,
            addWave: 2,
            addWaves: 4,
            addsRemaining: 7,
            forgeBeams: [
              {
                index: 0,
                columnX: -18,
                columnZ: 20,
                impactX: -8,
                impactZ: 20,
                active: true,
                warning: false,
                blocked: true,
                blockerId: 9,
              },
              {
                index: 1,
                columnX: 38,
                columnZ: 20,
                impactX: 10,
                impactZ: 20,
                active: true,
                warning: true,
                blocked: false,
                blockerId: null,
              },
            ],
            interceptBeam: {
              sourceId: 7,
              targetId: 9,
              blockerId: 4,
              sourceX: 1.234,
              sourceZ: 2.345,
              targetX: 18.765,
              targetZ: 21.654,
              blockerX: 8.126,
              blockerZ: 11.234,
              width: 1.35,
              duration: 5,
              remaining: 2.25,
            },
            cores: [],
            deliveryWindowRemaining: 0,
            assignments: [{ playerId: 9, symbol: 2, locked: true }],
            runes,
            round: 0,
            rounds: 2,
            remaining: 18,
          },
        ],
      },
      { x: 0, z: 0 },
      50,
    );
    const parsed = JSON.parse(`{${json.slice(1)}}`);
    const assembly = parsed.varkhulAssemblies[0];
    expect(assembly.hc).toBe(1);
    expect(assembly).toMatchObject({ oh: 0.42, bm: 3, bw: 2.35, mr: 0, aw: 2, aws: 4, ar: 7 });
    expect(assembly.beams).toEqual([
      { i: 0, cx: -18, cz: 20, ix: -8, iz: 20, a: 1, w: 0, bid: 9 },
      { i: 1, cx: 38, cz: 20, ix: 10, iz: 20, a: 1, w: 1, bid: null },
    ]);
    expect(assembly.ib).toEqual({
      sid: 7,
      tid: 9,
      bid: 4,
      sx: 1.23,
      sz: 2.35,
      tx: 18.77,
      tz: 21.65,
      bx: 8.13,
      bz: 11.23,
      w: 1.35,
      dur: 5,
      rem: 2.25,
    });
    expect(assembly.assign).toEqual([{ pid: 9, sym: 2, lock: 1 }]);
    expect(assembly.runes).toHaveLength(10);
    expect(assembly.runes[2]).toMatchObject({
      sym: 2,
      x: 4.25,
      z: -6.47,
      r: 3.3,
      ti: 2,
      tr: 3,
      ta: 0.4,
      ga: 0.8,
      c: 2,
      cp: 0.75,
      ap: 1,
      al: 1,
      lock: 1,
      or: 1,
    });
    expect(Object.keys(assembly.runes[0]).sort()).toEqual(
      [
        'sym',
        'x',
        'z',
        'r',
        'ti',
        'tr',
        'oa',
        'ta',
        'ga',
        'c',
        'cp',
        'ap',
        'al',
        'lock',
        'or',
      ].sort(),
    );
    expect(JSON.stringify(assembly).length).toBeLessThan(2_250);
    const decodedAssembly = decodeVarkhulAssemblies(parsed.varkhulAssemblies)[0];
    expect(decodedAssembly).toMatchObject({ addWave: 2, addWaves: 4, addsRemaining: 7 });
    expect(decodedAssembly.forgeBeamWarmupRemaining).toBe(2.35);
    expect(decodedAssembly.interceptBeam).toEqual({
      sourceId: 7,
      targetId: 9,
      blockerId: 4,
      sourceX: 1.23,
      sourceZ: 2.35,
      targetX: 18.77,
      targetZ: 21.65,
      blockerX: 8.13,
      blockerZ: 11.23,
      width: 1.35,
      duration: 5,
      remaining: 2.25,
    });
    expect(decodedAssembly.runes[2]).toMatchObject({
      symbol: 2,
      trackIndex: 2,
      trackRadius: 3,
      assignedPlayerId: 9,
      orphaned: true,
      targetAngle: 0.4,
      glyphAngle: 0.8,
      control: 'clockwise',
      controlProgress: 0.75,
      alignmentProgress: 1,
      aligned: true,
      locked: true,
    });
  });

  it('serializes the active Forge Meltdown window after the beam phase ends', () => {
    const json = varkhulEncounterWireJson(
      {
        activeVarkhulForgestormWarnings: [],
        activeVarkhulCinderFires: [],
        activeVarkhulCinderOrbProjectiles: [],
        activeVarkhulAnvilMeteors: [],
        activeVarkhulAssemblies: [
          {
            bossId: 7,
            difficulty: 'heroic',
            phase: 'done',
            forgeX: 10,
            forgeZ: 20,
            forgeHp: 0,
            forgeMaxHp: 100,
            forgeOverheat: 1,
            forgeBeamActiveMask: 3,
            forgeBeamWarmupRemaining: 0,
            forgeMeltdownRemaining: 4.35,
            addWave: 0,
            addWaves: 0,
            addsRemaining: 0,
            forgeBeams: [],
            interceptBeam: null,
            cores: [],
            deliveryWindowRemaining: 0,
            assignments: [],
            runes: [],
            round: 1,
            rounds: 2,
            remaining: 0,
          },
        ],
      },
      { x: 0, z: 0 },
      50,
    );
    const parsed = JSON.parse(`{${json.slice(1)}}`);
    expect(parsed.varkhulAssemblies[0]).toMatchObject({ phase: 'done', mr: 4.35, beams: [] });
    expect(decodeVarkhulAssemblies(parsed.varkhulAssemblies)[0]).toMatchObject({
      phase: 'done',
      forgeMeltdownRemaining: 4.35,
      forgeBeams: [],
    });
  });
});
