// The Nythraxis Grave Eruption / Grave Flame snapshot wire: the server fragment
// (server/nythraxis_wire.ts riding server/ground_telegraph_wire.ts) and the
// client decoders plus the one-call sink apply (src/net/ground_telegraph_wire.ts).
import { describe, expect, it } from 'vitest';
import {
  type GroundTelegraphWireWorld,
  type GroundTelegraphWorldSource,
  groundTelegraphWireJson,
  groundTelegraphWorld,
} from '../server/ground_telegraph_wire';
import { nythraxisEncounterWireJson } from '../server/nythraxis_wire';
import {
  applyGroundTelegraphSnapshot,
  decodeNythraxisBindingSigils,
  decodeNythraxisGraveEruptions,
  decodeNythraxisGraveFlames,
  decodeNythraxisGravefires,
  type GroundTelegraphSnapshotSink,
} from '../src/net/ground_telegraph_wire';
import type { ActiveNythraxisBindingSigil } from '../src/sim/nythraxis_binding_sigil';
import type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from '../src/sim/nythraxis_grave_eruption';
import type { ActiveNythraxisGravefire } from '../src/sim/nythraxis_gravefire';

const EVENT_RADIUS = 90;

const ERUPTION_NEAR: ActiveNythraxisGraveEruption = {
  id: '77:ge:41:0',
  x: 3.126,
  z: 4.234,
  radius: 3,
  duration: 2.5,
  remaining: 1.4,
  warningLead: 0.75,
};
const ERUPTION_FAR: ActiveNythraxisGraveEruption = { ...ERUPTION_NEAR, id: '77:ge:41:1', x: 200 };
const FLAME_NEAR: ActiveNythraxisGraveFlame = {
  id: '77:gf:3',
  sourceId: 77,
  kind: 'grave',
  x: 5.126,
  z: 6.234,
  radius: 3,
  duration: 12,
  remaining: 7.005,
};
const FLAME_FAR: ActiveNythraxisGraveFlame = { ...FLAME_NEAR, id: '77:gf:4', z: -200 };
const GRAVEFIRE_NEAR: ActiveNythraxisGravefire = {
  id: '77:gfl:5',
  sourceId: 77,
  x: 7.126,
  z: 8.234,
  dirX: 0.6,
  dirZ: 0.8,
  tail: 2.345,
  head: 19.876,
  halfWidth: 1.5,
  remaining: 4.555,
};
const GRAVEFIRE_FAR: ActiveNythraxisGravefire = {
  ...GRAVEFIRE_NEAR,
  id: '77:gfl:6',
  x: 200,
};
const SIGIL_NEAR: ActiveNythraxisBindingSigil = {
  id: '77:sig:8',
  sourceId: 77,
  x: 9.126,
  z: 10.234,
  radius: 4,
  duration: 15,
  remaining: 11.555,
};
const SIGIL_FAR: ActiveNythraxisBindingSigil = { ...SIGIL_NEAR, id: '77:sig:9', z: 200 };
const GRAVEFIRE_ROW = {
  id: '77:gfl:5',
  src: 77,
  x: 8,
  z: 9,
  dx: 0.6,
  dz: 0.8,
  tail: 2,
  head: 20,
  hw: 1.5,
  rem: 4,
};
const SIGIL_ROW = { id: '77:sig:8', src: 77, x: 8, z: 9, r: 4, dur: 15, rem: 11 };

function emptyWireWorld(): GroundTelegraphWireWorld {
  return {
    activeFrostRings: [],
    activeIgnivarMeteors: [],
    activeTemporalHourglasses: [],
    activeConsecrations: [],
    varkhulEncounter: {
      activeVarkhulForgestormWarnings: [],
      activeVarkhulCinderFires: [],
      activeVarkhulCinderOrbProjectiles: [],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulAssemblies: [],
    },
    nythraxisEncounter: {
      activeNythraxisGraveEruptions: [],
      activeNythraxisGraveFlames: [],
      activeNythraxisGravefires: [],
      activeNythraxisBindingSigils: [],
    },
    interestQueryRadius: 60,
    eventRadius: EVENT_RADIUS,
  };
}

function parseFragment(json: string): Record<string, unknown> {
  return json.length === 0 ? {} : JSON.parse(`{${json.slice(1)}}`);
}

describe('Nythraxis snapshot wire fragment (server)', () => {
  it('emits nothing when both readouts are empty', () => {
    expect(
      nythraxisEncounterWireJson(
        {
          activeNythraxisGraveEruptions: [],
          activeNythraxisGraveFlames: [],
          activeNythraxisGravefires: [],
          activeNythraxisBindingSigils: [],
        },
        { x: 0, z: 0 },
        EVENT_RADIUS,
      ),
    ).toBe('');
    expect(groundTelegraphWireJson(emptyWireWorld(), { x: 0, z: 0 }, 60)).toBe('');
  });

  it('emits rounded terse rows inside the event radius and drops rows outside it', () => {
    const json = nythraxisEncounterWireJson(
      {
        activeNythraxisGraveEruptions: [ERUPTION_NEAR, ERUPTION_FAR],
        activeNythraxisGraveFlames: [FLAME_NEAR, FLAME_FAR],
        activeNythraxisGravefires: [GRAVEFIRE_NEAR, GRAVEFIRE_FAR],
        activeNythraxisBindingSigils: [SIGIL_NEAR, SIGIL_FAR],
      },
      { x: 0, z: 0 },
      EVENT_RADIUS,
    );
    expect(parseFragment(json)).toEqual({
      nythraxisEruptions: [
        { id: '77:ge:41:0', x: 3.13, z: 4.23, r: 3, dur: 2.5, rem: 1.4, lead: 0.75 },
      ],
      nythraxisFlames: [
        { id: '77:gf:3', src: 77, k: 'grave', x: 5.13, z: 6.23, r: 3, dur: 12, rem: 7.01 },
      ],
      nythraxisGravefires: [
        {
          id: '77:gfl:5',
          src: 77,
          x: 7.13,
          z: 8.23,
          dx: 0.6,
          dz: 0.8,
          tail: 2.35,
          head: 19.88,
          hw: 1.5,
          rem: 4.56,
        },
      ],
      nythraxisSigils: [{ id: '77:sig:8', src: 77, x: 9.13, z: 10.23, r: 4, dur: 15, rem: 11.56 }],
    });
    expect(Object.keys((parseFragment(json).nythraxisEruptions as object[])[0])).toEqual([
      'id',
      'x',
      'z',
      'r',
      'dur',
      'rem',
      'lead',
    ]);
    expect(Object.keys((parseFragment(json).nythraxisFlames as object[])[0])).toEqual([
      'id',
      'src',
      'k',
      'x',
      'z',
      'r',
      'dur',
      'rem',
    ]);
    expect(Object.keys((parseFragment(json).nythraxisGravefires as object[])[0])).toEqual([
      'id',
      'src',
      'x',
      'z',
      'dx',
      'dz',
      'tail',
      'head',
      'hw',
      'rem',
    ]);
    expect(Object.keys((parseFragment(json).nythraxisSigils as object[])[0])).toEqual([
      'id',
      'src',
      'x',
      'z',
      'r',
      'dur',
      'rem',
    ]);
  });

  it('keeps a warning on the event horizon, not the narrower interest radius', () => {
    const world = emptyWireWorld();
    world.interestQueryRadius = 10;
    world.nythraxisEncounter = {
      activeNythraxisGraveEruptions: [{ ...ERUPTION_NEAR, x: 80 }],
      activeNythraxisGraveFlames: [{ ...FLAME_NEAR, x: 80 }],
      activeNythraxisGravefires: [{ ...GRAVEFIRE_NEAR, x: 80 }],
      activeNythraxisBindingSigils: [{ ...SIGIL_NEAR, x: 80 }],
    };
    const parsed = parseFragment(groundTelegraphWireJson(world, { x: 0, z: 0 }, 10));
    expect(parsed.nythraxisEruptions).toHaveLength(1);
    expect(parsed.nythraxisFlames).toHaveLength(1);
    expect(parsed.nythraxisGravefires).toHaveLength(1);
    expect(parsed.nythraxisSigils).toHaveLength(1);
    world.nythraxisEncounter = {
      activeNythraxisGraveEruptions: [{ ...ERUPTION_NEAR, x: EVENT_RADIUS + 0.01 }],
      activeNythraxisGraveFlames: [{ ...FLAME_NEAR, x: EVENT_RADIUS + 0.01 }],
      activeNythraxisGravefires: [{ ...GRAVEFIRE_NEAR, x: EVENT_RADIUS + 0.01 }],
      activeNythraxisBindingSigils: [{ ...SIGIL_NEAR, x: EVENT_RADIUS + 0.01 }],
    };
    expect(groundTelegraphWireJson(world, { x: 0, z: 0 }, 10)).toBe('');
  });

  it('reads each Nythraxis readout exactly once per realm projection', () => {
    const reads = { eruptions: 0, flames: 0, gravefires: 0, sigils: 0 };
    const eruptions: ActiveNythraxisGraveEruption[] = [ERUPTION_NEAR];
    const flames: ActiveNythraxisGraveFlame[] = [FLAME_NEAR];
    const gravefires: ActiveNythraxisGravefire[] = [GRAVEFIRE_NEAR];
    const sigils: ActiveNythraxisBindingSigil[] = [SIGIL_NEAR];
    const source: GroundTelegraphWorldSource = {
      activeFrostRings: [],
      activeIgnivarMeteors: [],
      activeTemporalHourglasses: [],
      activeConsecrations: [],
      activeVarkhulForgestormWarnings: [],
      activeVarkhulCinderFires: [],
      activeVarkhulCinderOrbProjectiles: [],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulAssemblies: [],
      get activeNythraxisGraveEruptions() {
        reads.eruptions++;
        return eruptions;
      },
      get activeNythraxisGraveFlames() {
        reads.flames++;
        return flames;
      },
      get activeNythraxisGravefires() {
        reads.gravefires++;
        return gravefires;
      },
      get activeNythraxisBindingSigils() {
        reads.sigils++;
        return sigils;
      },
    };
    const world = groundTelegraphWorld(source, 60, EVENT_RADIUS);
    // Two viewers serialize off the same projection without touching the sim.
    groundTelegraphWireJson(world, { x: 0, z: 0 }, 60);
    groundTelegraphWireJson(world, { x: 500, z: 0 }, 60);
    expect(reads).toEqual({ eruptions: 1, flames: 1, gravefires: 1, sigils: 1 });
    expect(world.nythraxisEncounter.activeNythraxisGraveEruptions).toBe(eruptions);
    expect(world.nythraxisEncounter.activeNythraxisGraveFlames).toBe(flames);
    expect(world.nythraxisEncounter.activeNythraxisGravefires).toBe(gravefires);
    expect(world.nythraxisEncounter.activeNythraxisBindingSigils).toBe(sigils);
  });

  it('appends the Nythraxis families after the pre-existing key order', () => {
    const world = emptyWireWorld();
    world.activeFrostRings = [
      { id: 'ring:1', x: 0, z: 0, radius: 6, innerRadius: 2, duration: 5, remaining: 2 },
    ];
    world.activeConsecrations = [{ id: 'con:1', x: 0, z: 0, radius: 4, duration: 8, remaining: 3 }];
    world.nythraxisEncounter = {
      activeNythraxisGraveEruptions: [ERUPTION_NEAR],
      activeNythraxisGraveFlames: [FLAME_NEAR],
      activeNythraxisGravefires: [GRAVEFIRE_NEAR],
      activeNythraxisBindingSigils: [SIGIL_NEAR],
    };
    expect(Object.keys(parseFragment(groundTelegraphWireJson(world, { x: 0, z: 0 }, 60)))).toEqual([
      'rings',
      'consecrations',
      'nythraxisEruptions',
      'nythraxisFlames',
      'nythraxisGravefires',
      'nythraxisSigils',
    ]);
  });
});

describe('Nythraxis snapshot decoders (client)', () => {
  const eruptionRow = { id: '77:ge:41:0', x: 3, z: 5, r: 3, dur: 2.5, rem: 1.4, lead: 0.75 };
  const flameRow = { id: '77:gf:3', src: 77, k: 'grave', x: 8, z: 9, r: 3, dur: 12, rem: 7 };

  it('returns empty arrays for a non-array payload', () => {
    expect(decodeNythraxisGraveEruptions(undefined)).toEqual([]);
    expect(decodeNythraxisGraveEruptions({})).toEqual([]);
    expect(decodeNythraxisGraveFlames(null)).toEqual([]);
    expect(decodeNythraxisGraveFlames('rows')).toEqual([]);
    expect(decodeNythraxisGravefires(undefined)).toEqual([]);
    expect(decodeNythraxisGravefires({})).toEqual([]);
    expect(decodeNythraxisBindingSigils(null)).toEqual([]);
    expect(decodeNythraxisBindingSigils('rows')).toEqual([]);
  });

  it('decodes a valid eruption row and clamps remaining to duration', () => {
    expect(decodeNythraxisGraveEruptions([eruptionRow, { ...eruptionRow, rem: 9 }])).toEqual([
      { id: '77:ge:41:0', x: 3, z: 5, radius: 3, duration: 2.5, remaining: 1.4, warningLead: 0.75 },
      { id: '77:ge:41:0', x: 3, z: 5, radius: 3, duration: 2.5, remaining: 2.5, warningLead: 0.75 },
    ]);
  });

  it.each([
    ['non-object row', null],
    ['primitive row', 'junk'],
    ['id', { ...eruptionRow, id: 41 }],
    ['x', { ...eruptionRow, x: Number.NaN }],
    ['z', { ...eruptionRow, z: '5' }],
    ['missing radius', (({ r: _r, ...rest }) => rest)(eruptionRow)],
    ['radius', { ...eruptionRow, r: 0 }],
    ['duration', { ...eruptionRow, dur: 0 }],
    ['remaining', { ...eruptionRow, rem: 0 }],
    ['infinite remaining', { ...eruptionRow, rem: Number.POSITIVE_INFINITY }],
    ['negative lead', { ...eruptionRow, lead: -0.1 }],
    ['lead at or past duration', { ...eruptionRow, lead: 2.5 }],
  ])('drops an eruption row with an invalid %s', (_label, row) => {
    expect(decodeNythraxisGraveEruptions([row])).toEqual([]);
  });

  it('decodes a valid flame row and clamps remaining to duration', () => {
    expect(decodeNythraxisGraveFlames([flameRow, { ...flameRow, rem: 30 }])).toEqual([
      {
        id: '77:gf:3',
        sourceId: 77,
        kind: 'grave',
        x: 8,
        z: 9,
        radius: 3,
        duration: 12,
        remaining: 7,
      },
      {
        id: '77:gf:3',
        sourceId: 77,
        kind: 'grave',
        x: 8,
        z: 9,
        radius: 3,
        duration: 12,
        remaining: 12,
      },
    ]);
  });

  it.each([
    ['non-object row', null],
    ['primitive row', 7],
    ['id', { ...flameRow, id: 3 }],
    ['src', { ...flameRow, src: '77' }],
    ['non-finite src', { ...flameRow, src: Number.NaN }],
    ['missing src', (({ src: _src, ...rest }) => rest)(flameRow)],
    ['missing kind', (({ k: _k, ...rest }) => rest)(flameRow)],
    ['kind', { ...flameRow, k: 'ember' }],
    ['x', { ...flameRow, x: Number.NEGATIVE_INFINITY }],
    ['z', { ...flameRow, z: null }],
    ['radius', { ...flameRow, r: 0 }],
    ['duration', { ...flameRow, dur: 0 }],
    ['remaining', { ...flameRow, rem: 0 }],
  ])('drops a flame row with an invalid %s', (_label, row) => {
    expect(decodeNythraxisGraveFlames([row])).toEqual([]);
  });

  it('decodes a valid Gravefire row without clamping its countdown', () => {
    expect(decodeNythraxisGravefires([GRAVEFIRE_ROW, { ...GRAVEFIRE_ROW, rem: 30 }])).toEqual([
      {
        id: '77:gfl:5',
        sourceId: 77,
        x: 8,
        z: 9,
        dirX: 0.6,
        dirZ: 0.8,
        tail: 2,
        head: 20,
        halfWidth: 1.5,
        remaining: 4,
      },
      {
        id: '77:gfl:5',
        sourceId: 77,
        x: 8,
        z: 9,
        dirX: 0.6,
        dirZ: 0.8,
        tail: 2,
        head: 20,
        halfWidth: 1.5,
        remaining: 30,
      },
    ]);
  });

  it.each([
    ['non-object row', null],
    ['primitive row', 7],
    ['id', { ...GRAVEFIRE_ROW, id: 5 }],
    ['src', { ...GRAVEFIRE_ROW, src: '77' }],
    ['non-finite src', { ...GRAVEFIRE_ROW, src: Number.NaN }],
    ['x', { ...GRAVEFIRE_ROW, x: Number.POSITIVE_INFINITY }],
    ['z', { ...GRAVEFIRE_ROW, z: null }],
    ['dx', { ...GRAVEFIRE_ROW, dx: '0.6' }],
    ['dz', { ...GRAVEFIRE_ROW, dz: Number.NaN }],
    ['negative tail', { ...GRAVEFIRE_ROW, tail: -0.01 }],
    ['head below tail', { ...GRAVEFIRE_ROW, head: 1 }],
    ['half width', { ...GRAVEFIRE_ROW, hw: 0 }],
    ['remaining', { ...GRAVEFIRE_ROW, rem: 0 }],
    ['short direction', { ...GRAVEFIRE_ROW, dx: 0.5, dz: 0.5 }],
    ['long direction', { ...GRAVEFIRE_ROW, dx: 1, dz: 0.2 }],
  ])('drops a Gravefire row with an invalid %s', (_label, row) => {
    expect(decodeNythraxisGravefires([row])).toEqual([]);
  });

  it('keeps a just-lit line whose window is still zero length at the origin', () => {
    // The sim readout carries tail = head = 0 from the ignition tick
    // (nythraxisGravefireExtent), so the online client must not drop it.
    expect(decodeNythraxisGravefires([{ ...GRAVEFIRE_ROW, tail: 0, head: 0 }])).toHaveLength(1);
  });

  it('accepts both inclusive unit-ish direction limits', () => {
    expect(
      decodeNythraxisGravefires([
        { ...GRAVEFIRE_ROW, dx: 0.99, dz: 0 },
        { ...GRAVEFIRE_ROW, dx: 1.01, dz: 0 },
      ]),
    ).toHaveLength(2);
  });

  it('decodes a valid Binding Sigil row and clamps remaining to duration', () => {
    expect(decodeNythraxisBindingSigils([SIGIL_ROW, { ...SIGIL_ROW, rem: 30 }])).toEqual([
      { id: '77:sig:8', sourceId: 77, x: 8, z: 9, radius: 4, duration: 15, remaining: 11 },
      { id: '77:sig:8', sourceId: 77, x: 8, z: 9, radius: 4, duration: 15, remaining: 15 },
    ]);
  });

  it.each([
    ['non-object row', null],
    ['primitive row', 'junk'],
    ['id', { ...SIGIL_ROW, id: 8 }],
    ['src', { ...SIGIL_ROW, src: '77' }],
    ['non-finite src', { ...SIGIL_ROW, src: Number.NaN }],
    ['x', { ...SIGIL_ROW, x: Number.NEGATIVE_INFINITY }],
    ['z', { ...SIGIL_ROW, z: null }],
    ['radius', { ...SIGIL_ROW, r: 0 }],
    ['duration', { ...SIGIL_ROW, dur: 0 }],
    ['remaining', { ...SIGIL_ROW, rem: 0 }],
  ])('drops a Binding Sigil row with an invalid %s', (_label, row) => {
    expect(decodeNythraxisBindingSigils([row])).toEqual([]);
  });

  it('round-trips the server fragment through the decoders', () => {
    const parsed = parseFragment(
      nythraxisEncounterWireJson(
        {
          activeNythraxisGraveEruptions: [ERUPTION_NEAR],
          activeNythraxisGraveFlames: [FLAME_NEAR],
          activeNythraxisGravefires: [GRAVEFIRE_NEAR],
          activeNythraxisBindingSigils: [SIGIL_NEAR],
        },
        { x: 0, z: 0 },
        EVENT_RADIUS,
      ),
    );
    expect(decodeNythraxisGraveEruptions(parsed.nythraxisEruptions)).toEqual([
      { ...ERUPTION_NEAR, x: 3.13, z: 4.23 },
    ]);
    expect(decodeNythraxisGraveFlames(parsed.nythraxisFlames)).toEqual([
      { ...FLAME_NEAR, x: 5.13, z: 6.23, remaining: 7.01 },
    ]);
    expect(decodeNythraxisGravefires(parsed.nythraxisGravefires)).toEqual([
      {
        ...GRAVEFIRE_NEAR,
        x: 7.13,
        z: 8.23,
        tail: 2.35,
        head: 19.88,
        remaining: 4.56,
      },
    ]);
    expect(decodeNythraxisBindingSigils(parsed.nythraxisSigils)).toEqual([
      { ...SIGIL_NEAR, x: 9.13, z: 10.23, remaining: 11.56 },
    ]);
  });
});

describe('applyGroundTelegraphSnapshot', () => {
  function sink(): GroundTelegraphSnapshotSink {
    return {
      activeFrostRings: [],
      activeIgnivarMeteors: [],
      activeNythraxisGraveEruptions: [],
      activeNythraxisGraveFlames: [],
      activeNythraxisGravefires: [],
      activeNythraxisBindingSigils: [],
      activeVarkhulForgestormWarnings: [],
      activeVarkhulCinderFires: [],
      activeVarkhulCinderOrbProjectiles: [],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulAssemblies: [],
      activeTemporalHourglasses: [],
      activeConsecrations: [],
    };
  }

  it('lands every family of one frame on the sink, the Nythraxis keys included', () => {
    const target = sink();
    applyGroundTelegraphSnapshot(target, {
      rings: [{ id: 'ring:1', x: 3, z: 4, r: 6, i: 2, dur: 5, rem: 2 }],
      ignivarMeteors: [{ id: '9:912:0', x: 3, z: 5, r: 2.4, dur: 2.5, rem: 1.4, lead: 0.75 }],
      nythraxisEruptions: [{ id: '77:ge:41:0', x: 3, z: 5, r: 3, dur: 2.5, rem: 1.4, lead: 0.75 }],
      nythraxisFlames: [{ id: '77:gf:3', src: 77, k: 'soul', x: 8, z: 9, r: 4, dur: 15, rem: 7 }],
      nythraxisGravefires: [GRAVEFIRE_ROW],
      nythraxisSigils: [SIGIL_ROW],
      varkhulForgestorm: [
        {
          id: 'varkhul-forgestorm:9:1:0:0',
          sourceId: 9,
          x: 1,
          z: 2,
          r: 3,
          dur: 6,
          rem: 4,
          lead: 0,
        },
      ],
      varkhulCinderFires: [{ id: '9:cinder-fire:2:0', sourceId: 9, x: 5, z: 6, r: 3.5 }],
      varkhulAnvilMeteors: [{ id: 'meteor:1', x: 3, z: 5, r: 3.5, dur: 1.8, rem: 1.2, lead: 0 }],
      hourglasses: [{ id: 'hg:1', x: 1, z: 2, r: 4, dur: 8, rem: 3 }],
      consecrations: [{ id: 'con:1', x: 5, z: 6, r: 4, dur: 8, rem: 3 }],
    });
    expect(target.activeFrostRings.map((row) => row.id)).toEqual(['ring:1']);
    expect(target.activeIgnivarMeteors.map((row) => row.id)).toEqual(['9:912:0']);
    expect(target.activeNythraxisGraveEruptions).toEqual([
      { id: '77:ge:41:0', x: 3, z: 5, radius: 3, duration: 2.5, remaining: 1.4, warningLead: 0.75 },
    ]);
    expect(target.activeNythraxisGraveFlames).toEqual([
      {
        id: '77:gf:3',
        sourceId: 77,
        kind: 'soul',
        x: 8,
        z: 9,
        radius: 4,
        duration: 15,
        remaining: 7,
      },
    ]);
    expect(target.activeNythraxisGravefires).toEqual([
      {
        id: '77:gfl:5',
        sourceId: 77,
        x: 8,
        z: 9,
        dirX: 0.6,
        dirZ: 0.8,
        tail: 2,
        head: 20,
        halfWidth: 1.5,
        remaining: 4,
      },
    ]);
    expect(target.activeNythraxisBindingSigils).toEqual([
      { id: '77:sig:8', sourceId: 77, x: 8, z: 9, radius: 4, duration: 15, remaining: 11 },
    ]);
    expect(target.activeVarkhulForgestormWarnings.map((row) => row.id)).toEqual([
      'varkhul-forgestorm:9:1:0:0',
    ]);
    expect(target.activeVarkhulCinderFires.map((row) => row.id)).toEqual(['9:cinder-fire:2:0']);
    expect(target.activeVarkhulAnvilMeteors.map((row) => row.id)).toEqual(['meteor:1']);
    expect(target.activeVarkhulCinderOrbProjectiles).toEqual([]);
    expect(target.activeVarkhulAssemblies).toEqual([]);
    expect(target.activeTemporalHourglasses.map((row) => row.id)).toEqual(['hg:1']);
    expect(target.activeConsecrations.map((row) => row.id)).toEqual(['con:1']);
  });

  it('clears every family when the frame omits its key (not delta-gated)', () => {
    const target = sink();
    target.activeNythraxisGraveEruptions = [ERUPTION_NEAR];
    target.activeNythraxisGraveFlames = [FLAME_NEAR];
    target.activeNythraxisGravefires = [GRAVEFIRE_NEAR];
    target.activeNythraxisBindingSigils = [SIGIL_NEAR];
    target.activeFrostRings = [
      { id: 'ring:1', x: 0, z: 0, radius: 6, innerRadius: 2, duration: 5, remaining: 2 },
    ];
    applyGroundTelegraphSnapshot(target, { t: 'snap', ents: [] });
    expect(target).toEqual(sink());
  });
});
