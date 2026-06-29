import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NAMEPLATE_ANCHOR_LIFT,
  NAMEPLATE_RANGE,
  NAMEPLATE_RANGE_SQ,
  NAMEPLATE_SELF_EMOTE_ANCHOR_LIFT,
  NAMEPLATE_URGENT_RANGE,
  nameplatePlanInto,
  newNameplatePlan,
} from '../src/render/nameplate_view';

// The nameplate_view core: the pure DOM/Three/i18n-free decision model the
// NameplatePainter consumes. These pin the exact visibility / anchor / urgent /
// threat / combo behavior lifted out of renderer.updateNameplates, the
// allocation-light out-param contract, the Sim-vs-ClientWorld parity guard,
// and the no-governor import-absence (the two-controller hazard:
// the core must not read the FPS governor, which lives in src/render alongside it
// and so is NOT caught by the architecture purity guard's render-sibling allowance).

const PLAYER_ID = 1;

// A minimal entity-view the core reads (everything else on Entity is ignored).
// Default: a live wild wolf at the origin, far enough to matter per case.
function ent(overrides: Record<string, unknown> = {}): any {
  return {
    id: 2,
    kind: 'mob',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    lootable: false,
    templateId: 'wolf',
    dungeonId: null,
    scale: 1,
    overheadEmoteId: null,
    castingAbility: null,
    aggroTargetId: null,
    ownerId: null,
    ...overrides,
  };
}

function viewer(overrides: Record<string, unknown> = {}): any {
  return {
    id: PLAYER_ID,
    kind: 'player',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    targetId: null,
    comboTargetId: null,
    comboPoints: 0,
    ...overrides,
  };
}

function plan(e: any, p: any = viewer(), viewHeight = 2, showNameplates = true) {
  return nameplatePlanInto(newNameplatePlan(), e, p, viewHeight, showNameplates);
}

describe('nameplate_view - visibility', () => {
  it('hides the local player normally, shows it only for an overhead emote', () => {
    const me = ent({ id: PLAYER_ID, kind: 'player' });
    expect(plan(me, viewer({ id: PLAYER_ID })).hidden).toBe(true);
    const meEmote = ent({ id: PLAYER_ID, kind: 'player', overheadEmoteId: 'wave' });
    expect(plan(meEmote, viewer({ id: PLAYER_ID })).hidden).toBe(false);
  });

  it('hides any entity beyond NAMEPLATE_RANGE and shows it just inside', () => {
    // NAMEPLATE_RANGE is the radius; just past it on z is hidden, just inside shows.
    expect(plan(ent({ pos: { x: 0, y: 0, z: NAMEPLATE_RANGE + 1 } })).hidden).toBe(true);
    expect(plan(ent({ pos: { x: 0, y: 0, z: NAMEPLATE_RANGE - 1 } })).hidden).toBe(false);
    // boundary is squared distance vs NAMEPLATE_RANGE_SQ
    expect(NAMEPLATE_RANGE * NAMEPLATE_RANGE).toBe(NAMEPLATE_RANGE_SQ);
  });

  it('hides a dead non-lootable mob (corpse), shows a lootable one', () => {
    expect(plan(ent({ dead: true, lootable: false })).hidden).toBe(true);
    expect(plan(ent({ dead: true, lootable: true })).hidden).toBe(false);
  });

  it('hides a plain ground object but shows dungeon doors and nearby delve interactables', () => {
    expect(plan(ent({ kind: 'object', templateId: 'crate' })).hidden).toBe(true);
    expect(
      plan(ent({ kind: 'object', templateId: 'dungeon_door', dungeonId: 'crypt' })).hidden,
    ).toBe(false);
    // a delve chest only labels when within (INTERACT_RANGE+1); far away it hides.
    expect(
      plan(ent({ kind: 'object', templateId: 'delve_reward_chest', pos: { x: 0, y: 0, z: 1 } }))
        .hidden,
    ).toBe(false);
    expect(
      plan(ent({ kind: 'object', templateId: 'delve_reward_chest', pos: { x: 0, y: 0, z: 30 } }))
        .hidden,
    ).toBe(true);
  });

  it('hides the sealed royal door inside the boss arena (it reads as back wall)', () => {
    expect(
      plan(ent({ kind: 'object', templateId: 'dungeon_door', dungeonId: 'nythraxis_boss_arena' }))
        .hidden,
    ).toBe(true);
  });

  it('the mob-nameplate toggle hides live mobs only, never players/npcs/objects', () => {
    expect(plan(ent({ kind: 'mob' }), viewer(), 2, false).hidden).toBe(true);
    expect(plan(ent({ kind: 'mob', dead: true, lootable: true }), viewer(), 2, false).hidden).toBe(
      false,
    ); // a lootable corpse is not a "live mob"
    expect(plan(ent({ id: 3, kind: 'player' }), viewer(), 2, false).hidden).toBe(false);
    expect(plan(ent({ kind: 'npc' }), viewer(), 2, false).hidden).toBe(false);
  });
});

describe('nameplate_view - urgent (content refreshes every pass)', () => {
  it('is urgent when targeted, very close, or casting; otherwise not', () => {
    const farIdle = ent({ pos: { x: 0, y: 0, z: 40 } });
    expect(plan(farIdle).urgent).toBe(false);
    expect(plan(farIdle, viewer({ targetId: farIdle.id })).urgent).toBe(true);
    expect(plan(ent({ pos: { x: 0, y: 0, z: NAMEPLATE_URGENT_RANGE - 1 } })).urgent).toBe(true);
    expect(plan(ent({ pos: { x: 0, y: 0, z: NAMEPLATE_URGENT_RANGE + 1 } })).urgent).toBe(false);
    expect(plan(ent({ pos: { x: 0, y: 0, z: 40 }, castingAbility: 'fireball' })).urgent).toBe(true);
  });
});

describe('nameplate_view - anchor lift (projection input)', () => {
  it('lifts by viewHeight*scale + the normal lift, and uses the lower lift for a self emote', () => {
    expect(plan(ent({ scale: 1 }), viewer(), 2).anchorYOffset).toBe(2 + NAMEPLATE_ANCHOR_LIFT);
    expect(plan(ent({ scale: 1.5 }), viewer(), 2).anchorYOffset).toBe(3 + NAMEPLATE_ANCHOR_LIFT);
    const meEmote = ent({ id: PLAYER_ID, kind: 'player', overheadEmoteId: 'wave', scale: 1 });
    expect(plan(meEmote, viewer({ id: PLAYER_ID }), 2).anchorYOffset).toBe(
      2 + NAMEPLATE_SELF_EMOTE_ANCHOR_LIFT,
    );
  });
});

describe('nameplate_view - threat + combo (delegated to the narrow helpers)', () => {
  it('flags the threat plate for a live wild mob aggroed on the viewer', () => {
    expect(plan(ent({ aggroTargetId: PLAYER_ID })).threat).toBe(true);
    expect(plan(ent({ aggroTargetId: 99 })).threat).toBe(false);
    expect(plan(ent({ aggroTargetId: PLAYER_ID, ownerId: PLAYER_ID })).threat).toBe(false); // my pet
  });

  it('reports the combo pips the viewer has built on this exact entity', () => {
    const foe = ent({ pos: { x: 0, y: 0, z: 5 } });
    expect(plan(foe, viewer({ comboTargetId: foe.id, comboPoints: 3 })).comboPips).toBe(3);
    expect(plan(foe, viewer({ comboTargetId: 999, comboPoints: 3 })).comboPips).toBe(0);
    expect(
      plan(
        { ...foe, dead: true, lootable: true },
        viewer({ comboTargetId: foe.id, comboPoints: 3 }),
      ).comboPips,
    ).toBe(0);
  });

  it('sets hasOverheadEmote for a live player wearing an overhead emote', () => {
    expect(
      plan(ent({ id: 3, kind: 'player', overheadEmoteId: 'cheer', pos: { x: 0, y: 0, z: 5 } }))
        .hasOverheadEmote,
    ).toBe(true);
    expect(
      plan(
        ent({
          id: 3,
          kind: 'player',
          overheadEmoteId: 'cheer',
          dead: true,
          pos: { x: 0, y: 0, z: 5 },
        }),
      ).hasOverheadEmote,
    ).toBe(false);
    expect(plan(ent({ kind: 'mob', pos: { x: 0, y: 0, z: 5 } })).hasOverheadEmote).toBe(false);
  });
});

describe('nameplate_view - allocation-light + determinism', () => {
  it('writes into the caller-owned plan and returns that same instance (no per-call alloc)', () => {
    const out = newNameplatePlan();
    const e = ent({ pos: { x: 0, y: 0, z: 5 } });
    const returned = nameplatePlanInto(out, e, viewer(), 2, true);
    expect(returned).toBe(out); // same reference, reused
  });

  it('same input gives the same plan (pure)', () => {
    const e = ent({ pos: { x: 0, y: 0, z: 5 }, aggroTargetId: PLAYER_ID });
    const p = viewer({ comboTargetId: e.id, comboPoints: 2, targetId: e.id });
    const a = nameplatePlanInto(newNameplatePlan(), e, p, 2, true);
    const b = nameplatePlanInto(newNameplatePlan(), e, p, 2, true);
    expect(a).toEqual(b);
  });
});

describe('nameplate_view - Sim-vs-ClientWorld parity', () => {
  // The painter consumes IWorld, which both the offline Sim and the online
  // ClientWorld mirror satisfy, but only Sim is exercised by the perf harness. If
  // the core read a Sim-only field shape, it would render right offline and wrong
  // online. We model each host: the Sim entity carries extra sim-only internals;
  // the ClientWorld mirror carries ONLY the wire-rendered fields the core reads.
  // Identical plans prove the core depends on nothing Sim-only.
  const scenarios: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      'aggroed mob with combo',
      { kind: 'mob', pos: { x: 0, y: 0, z: 6 }, aggroTargetId: PLAYER_ID },
      { comboTargetId: 2, comboPoints: 4, targetId: 2 },
    ],
    [
      'friendly door object',
      { kind: 'object', templateId: 'dungeon_door', dungeonId: 'crypt', pos: { x: 0, y: 0, z: 3 } },
      {},
    ],
    [
      'self overhead emote',
      { id: PLAYER_ID, kind: 'player', overheadEmoteId: 'wave', scale: 1.2 },
      { id: PLAYER_ID },
    ],
    ['distant idle player', { id: 5, kind: 'player', pos: { x: 0, y: 0, z: 40 } }, {}],
  ];

  for (const [label, eo, po] of scenarios) {
    it(`produces an identical plan for ${label} under both host shapes`, () => {
      // Sim-shaped: full entity + arbitrary sim-only internals the wire never sends.
      const simE = ent({ ...eo, _simCooldowns: { a: 1 }, _path: [1, 2, 3], serverTick: 99 });
      const simP = viewer({ ...po, _simCooldowns: {}, threatTable: { 2: 5 } });
      // ClientWorld-mirror-shaped: ONLY the fields the core reads, sim-only absent.
      const mirE = ent({ ...eo });
      const mirP = viewer({ ...po });
      const simPlan = nameplatePlanInto(newNameplatePlan(), simE, simP, 2, true);
      const mirPlan = nameplatePlanInto(newNameplatePlan(), mirE, mirP, 2, true);
      expect(simPlan).toEqual(mirPlan);
    });
  }
});

describe('nameplate_view - import absence (two-controller + purity, source scan)', () => {
  // The architecture purity guard (RENDER_PURE_CORES) already forbids three / a
  // *_painter / game,net / i18n for this core, but it ALLOWS render siblings, so it
  // would NOT catch the core importing the FPS governor (render_budget, a render
  // sibling). Pin the no-governor rule explicitly: the nameplate cadence is owned by
  // the static preset, never the governor, so the core must not reach for it.
  const src = readFileSync(
    fileURLToPath(new URL('../src/render/nameplate_view.ts', import.meta.url)),
    'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('never imports or reads the FPS governor', () => {
    expect(code).not.toMatch(/render_budget/);
    expect(code).not.toMatch(/governor/i);
    expect(code).not.toMatch(/RenderBudget/);
    expect(code).not.toMatch(/\.state\s*\(/);
    expect(code).not.toMatch(/\.levels\b/);
  });

  it('imports nothing from three, a painter, or the gfx module', () => {
    const froms = [...code.matchAll(/\bimport\b[^;]*\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    // unique modules, robust to biome merging/splitting the type vs value sim import
    expect([...new Set(froms)].sort()).toEqual([
      '../sim/types',
      './nameplate_combo',
      './nameplate_threat',
    ]);
    expect(code).not.toMatch(/\bfrom\s*['"]three/);
    expect(code).not.toMatch(/_painter['"]/);
    expect(code).not.toMatch(/['"]\.\/gfx['"]/);
  });

  it('touches no DOM global and no nondeterministic clock/random', () => {
    expect(code).not.toMatch(/\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/);
    expect(code).not.toMatch(/\b(Math\.random|Date\.now|performance\.now)\b/);
  });
});

describe('nameplate interval WIRING - renderer reads the static stamp, never the governor', () => {
  // The two-controller seam for the nameplate cadence is in the renderer: it must
  // derive the interval from coerceFxTier(document.documentElement.dataset.fxLevel)
  // (the static preset stamp), never an FPS-governor level. The knob mapping itself is
  // pinned in ui_tier_knobs.test.ts; this pins the actual call site.
  const rendererSrc = readFileSync(
    fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)),
    'utf8',
  );

  it('derives nameplateInterval from coerceFxTier(document.documentElement.dataset.fxLevel)', () => {
    expect(rendererSrc).toMatch(
      /nameplateIntervalSec\(\s*coerceFxTier\(\s*document\.documentElement\.dataset\.fxLevel\s*\)\s*,?\s*\)/,
    );
  });

  it('no longer forks the nameplate cadence on the mobile runtime, and never on the governor', () => {
    expect(rendererSrc).not.toMatch(/isMobileRuntime\(\)\s*\?\s*1\s*\/\s*15/);
    expect(rendererSrc).not.toMatch(
      /nameplateInterval\s*=\s*this\.(renderBudgetGovernor|governor)/,
    );
  });
});
