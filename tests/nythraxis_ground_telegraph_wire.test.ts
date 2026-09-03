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
  decodeNythraxisGraveEruptions,
  decodeNythraxisGraveFlames,
  type GroundTelegraphSnapshotSink,
} from '../src/net/ground_telegraph_wire';
import type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from '../src/sim/nythraxis_grave_eruption';

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
  x: 5.126,
  z: 6.234,
  radius: 3,
  duration: 12,
  remaining: 7.005,
};
const FLAME_FAR: ActiveNythraxisGraveFlame = { ...FLAME_NEAR, id: '77:gf:4', z: -200 };

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
    nythraxisEncounter: { activeNythraxisGraveEruptions: [], activeNythraxisGraveFlames: [] },
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
        { activeNythraxisGraveEruptions: [], activeNythraxisGraveFlames: [] },
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
      },
      { x: 0, z: 0 },
      EVENT_RADIUS,
    );
    expect(parseFragment(json)).toEqual({
      nythraxisEruptions: [
        { id: '77:ge:41:0', x: 3.13, z: 4.23, r: 3, dur: 2.5, rem: 1.4, lead: 0.75 },
      ],
      nythraxisFlames: [{ id: '77:gf:3', src: 77, x: 5.13, z: 6.23, r: 3, dur: 12, rem: 7.01 }],
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
    };
    const parsed = parseFragment(groundTelegraphWireJson(world, { x: 0, z: 0 }, 10));
    expect(parsed.nythraxisEruptions).toHaveLength(1);
    expect(parsed.nythraxisFlames).toHaveLength(1);
    world.nythraxisEncounter = {
      activeNythraxisGraveEruptions: [{ ...ERUPTION_NEAR, x: EVENT_RADIUS + 0.01 }],
      activeNythraxisGraveFlames: [{ ...FLAME_NEAR, x: EVENT_RADIUS + 0.01 }],
    };
    expect(groundTelegraphWireJson(world, { x: 0, z: 0 }, 10)).toBe('');
  });

  it('reads each Nythraxis readout exactly once per realm projection', () => {
    const reads = { eruptions: 0, flames: 0 };
    const eruptions: ActiveNythraxisGraveEruption[] = [ERUPTION_NEAR];
    const flames: ActiveNythraxisGraveFlame[] = [FLAME_NEAR];
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
    };
    const world = groundTelegraphWorld(source, 60, EVENT_RADIUS);
    // Two viewers serialize off the same projection without touching the sim.
    groundTelegraphWireJson(world, { x: 0, z: 0 }, 60);
    groundTelegraphWireJson(world, { x: 500, z: 0 }, 60);
    expect(reads).toEqual({ eruptions: 1, flames: 1 });
    expect(world.nythraxisEncounter.activeNythraxisGraveEruptions).toBe(eruptions);
    expect(world.nythraxisEncounter.activeNythraxisGraveFlames).toBe(flames);
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
    };
    expect(Object.keys(parseFragment(groundTelegraphWireJson(world, { x: 0, z: 0 }, 60)))).toEqual([
      'rings',
      'consecrations',
      'nythraxisEruptions',
      'nythraxisFlames',
    ]);
  });
});

describe('Nythraxis snapshot decoders (client)', () => {
  const eruptionRow = { id: '77:ge:41:0', x: 3, z: 5, r: 3, dur: 2.5, rem: 1.4, lead: 0.75 };
  const flameRow = { id: '77:gf:3', src: 77, x: 8, z: 9, r: 3, dur: 12, rem: 7 };

  it('returns empty arrays for a non-array payload', () => {
    expect(decodeNythraxisGraveEruptions(undefined)).toEqual([]);
    expect(decodeNythraxisGraveEruptions({})).toEqual([]);
    expect(decodeNythraxisGraveFlames(null)).toEqual([]);
    expect(decodeNythraxisGraveFlames('rows')).toEqual([]);
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
      { id: '77:gf:3', sourceId: 77, x: 8, z: 9, radius: 3, duration: 12, remaining: 7 },
      { id: '77:gf:3', sourceId: 77, x: 8, z: 9, radius: 3, duration: 12, remaining: 12 },
    ]);
  });

  it.each([
    ['non-object row', null],
    ['primitive row', 7],
    ['id', { ...flameRow, id: 3 }],
    ['src', { ...flameRow, src: '77' }],
    ['non-finite src', { ...flameRow, src: Number.NaN }],
    ['missing src', (({ src: _src, ...rest }) => rest)(flameRow)],
    ['x', { ...flameRow, x: Number.NEGATIVE_INFINITY }],
    ['z', { ...flameRow, z: null }],
    ['radius', { ...flameRow, r: 0 }],
    ['duration', { ...flameRow, dur: 0 }],
    ['remaining', { ...flameRow, rem: 0 }],
  ])('drops a flame row with an invalid %s', (_label, row) => {
    expect(decodeNythraxisGraveFlames([row])).toEqual([]);
  });

  it('round-trips the server fragment through the decoders', () => {
    const parsed = parseFragment(
      nythraxisEncounterWireJson(
        {
          activeNythraxisGraveEruptions: [ERUPTION_NEAR],
          activeNythraxisGraveFlames: [FLAME_NEAR],
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
  });
});

describe('applyGroundTelegraphSnapshot', () => {
  function sink(): GroundTelegraphSnapshotSink {
    return {
      activeFrostRings: [],
      activeIgnivarMeteors: [],
      activeNythraxisGraveEruptions: [],
      activeNythraxisGraveFlames: [],
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
      nythraxisFlames: [{ id: '77:gf:3', src: 77, x: 8, z: 9, r: 3, dur: 12, rem: 7 }],
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
      { id: '77:gf:3', sourceId: 77, x: 8, z: 9, radius: 3, duration: 12, remaining: 7 },
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
    target.activeFrostRings = [
      { id: 'ring:1', x: 0, z: 0, radius: 6, innerRadius: 2, duration: 5, remaining: 2 },
    ];
    applyGroundTelegraphSnapshot(target, { t: 'snap', ents: [] });
    expect(target).toEqual(sink());
  });
});
