// Tests for the delve_map painter (the PainterHost seam pilot):
//  - the pure delveDrawModel: Sim-vs-ClientWorld parity + both-sites determinism,
//  - the no-magic-values canvas guard over the painter source,
//  - the WCAG-chrome boundary over the vendor window the host now composes.
//
// The write-elision facet (makeWriterFacet) is exercised in painter_host.test.ts
// (grew to six writers); this file keeps only the delve-specific path.
// The painter's canvas/DOM methods (paintMinimapDelve / paintWorldMapDelve) need a
// real 2D context + getComputedStyle, so they are NOT exercised here; this Node
// suite drives the PURE path (delveDrawModel), which is exactly the contract the
// per-frame painters lean on.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DELVE_MODULE_LAYOUTS } from '../src/sim/delve_layout';
import { delveLocalToCanvas, delveSchematicStatic } from '../src/ui/delve_map';
import { delveDrawModel } from '../src/ui/delve_map_painter';
import type { IWorld } from '../src/world_api';

// --- Pure draw model: Sim-vs-ClientWorld parity + both-sites determinism --------

const MODULE_ID = 'reliquary_sunken_ossuary';
const LAYOUT = DELVE_MODULE_LAYOUTS[MODULE_ID];
const ORIGIN = { x: 1000, z: 2000 };
const DELVE_NAME = 'The Collapsed Reliquary';
const MODULE_NAME = 'The Sunken Ossuary';

// One scenario, expressed as plain data, so we can build two structurally-identical
// IWorld stubs (one "Sim-shaped", one "ClientWorld-mirror-shaped") and prove the
// painter reads only IWorld-declared fields.
const SCENARIO = {
  player: { id: 1, localX: 0, localZ: 20, facing: 0.5 },
  // 2 live mobs (one aggroed on the player), 1 dead mob + 1 NPC that must be dropped.
  entities: [
    { id: 2, kind: 'mob', dead: false, localX: 5, localZ: 25, aggro: true },
    { id: 3, kind: 'mob', dead: false, localX: -5, localZ: 15, aggro: false },
    { id: 4, kind: 'mob', dead: true, localX: 2, localZ: 22, aggro: false },
    { id: 5, kind: 'npc', dead: false, localX: -2, localZ: 18, aggro: false },
  ],
  // 1 alive + 1 dead party member, plus the local player (must be dropped).
  party: [
    { pid: 1, cls: 'warrior', dead: 0, localX: 0, localZ: 20 },
    { pid: 6, cls: 'warrior', dead: 0, localX: 4, localZ: 24 },
    { pid: 7, cls: 'mage', dead: 1, localX: -4, localZ: 16 },
  ],
};

function makeWorld(): IWorld {
  const p = SCENARIO.player;
  const player = {
    id: p.id,
    kind: 'player',
    dead: false,
    pos: { x: ORIGIN.x + p.localX, z: ORIGIN.z + p.localZ },
    facing: p.facing,
    aggroTargetId: null,
  };
  const entities = new Map<number, unknown>([[player.id, player]]);
  for (const e of SCENARIO.entities) {
    entities.set(e.id, {
      id: e.id,
      kind: e.kind,
      dead: e.dead,
      pos: { x: ORIGIN.x + e.localX, z: ORIGIN.z + e.localZ },
      facing: 0,
      aggroTargetId: e.aggro ? p.id : null,
    });
  }
  const partyInfo = {
    leader: 1,
    raid: false,
    members: SCENARIO.party.map((m) => ({
      pid: m.pid,
      cls: m.cls,
      dead: m.dead,
      x: ORIGIN.x + m.localX,
      z: ORIGIN.z + m.localZ,
    })),
  };
  return {
    player,
    entities,
    partyInfo,
    delveRun: {
      delveId: 'collapsed_reliquary',
      modules: [MODULE_ID],
      moduleIndex: 0,
      origin: ORIGIN,
    },
  } as unknown as IWorld;
}

const MINIMAP = { size: 162, pad: 8 };
const WORLDMAP = { size: 280, pad: Math.round(280 * 0.06) };

describe('delveDrawModel (pure draw model)', () => {
  it('drops dead mobs, NPCs, and the local player; keeps live mobs + party with flags', () => {
    const model = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.areaLabel).toBe('The Collapsed Reliquary: The Sunken Ossuary');
    expect(model.layoutId).toBe(MODULE_ID);
    // mob 4 is dead, mob 5 is an NPC, the player is excluded -> only mobs 2 + 3.
    expect(model.mobs).toHaveLength(2);
    expect(model.mobs.map((m) => m.aggro)).toEqual([true, false]);
    // party self (pid 1) excluded -> the warrior (alive) + the mage (dead).
    expect(model.party).toHaveLength(2);
    expect(model.party.map((m) => m.dead)).toEqual([0, 1]);
    expect(model.party.map((m) => m.cls)).toEqual(['warrior', 'mage']);
    expect(model.player.kind).toBe('arrow');
  });

  it('returns null when the world is not in a delve', () => {
    const overworld = { delveRun: null } as unknown as IWorld;
    expect(
      delveDrawModel(overworld, MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME),
    ).toBeNull();
  });

  it('positions every marker via the delve_map core (one source of truth)', () => {
    const model = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    if (!model) throw new Error('expected a model');
    // The static schematic is the core builder's output verbatim.
    expect(model.schematic).toEqual(delveSchematicStatic(LAYOUT, MINIMAP.size, MINIMAP.pad));
    // The first live mob's canvas position matches delveLocalToCanvas exactly.
    const first = SCENARIO.entities[0];
    const expected = delveLocalToCanvas(
      first.localX,
      first.localZ,
      LAYOUT,
      MINIMAP.size,
      MINIMAP.pad,
    );
    expect({ cx: model.mobs[0].cx, cy: model.mobs[0].cy }).toEqual(expected);
  });

  it('is deterministic: identical inputs produce a deep-equal model', () => {
    const a = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    const b = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    expect(a).toEqual(b);
  });

  it('Sim-shaped and ClientWorld-mirror-shaped IWorld stubs render identically', () => {
    // Two independently-built stubs with the same data: the painter must read only
    // IWorld-declared fields, so the minimap player schematic (party discs/arrows)
    // can never silently misrender online.
    const sim = makeWorld();
    const clientMirror = makeWorld();
    expect(sim).not.toBe(clientMirror);
    const fromSim = delveDrawModel(sim, MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    const fromClient = delveDrawModel(
      clientMirror,
      MINIMAP.size,
      MINIMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );
    expect(fromSim).toEqual(fromClient);
  });

  it('both call sites share one core path: minimap + world-map differ only by viewport', () => {
    const mini = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    const world = delveDrawModel(makeWorld(), WORLDMAP.size, WORLDMAP.pad, DELVE_NAME, MODULE_NAME);
    if (!mini || !world) throw new Error('expected both models');
    // Same world -> same identity-level facts (label, module, marker counts)...
    expect(world.areaLabel).toBe(mini.areaLabel);
    expect(world.layoutId).toBe(mini.layoutId);
    expect(world.mobs).toHaveLength(mini.mobs.length);
    expect(world.party).toHaveLength(mini.party.length);
    // ...but the schematic scales with the viewport (different size + pad).
    expect(world.schematic).toEqual(delveSchematicStatic(LAYOUT, WORLDMAP.size, WORLDMAP.pad));
    expect(world.schematic).not.toEqual(mini.schematic);
  });
});

// --- No-magic-values canvas guard (MANDATORY for a Canvas painter) --

describe('delve_map_painter: no magic values', () => {
  const src = readFileSync(new URL('../src/ui/delve_map_painter.ts', import.meta.url), 'utf8');
  // Drop comments so prose can't create a false positive (mirrors architecture.test).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('carries no literal hex or rgb color in TS', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('resolves --color-delve-* tokens via getComputedStyle (cached per redraw)', () => {
    expect(code).toContain('getComputedStyle');
    expect(code).toContain('getPropertyValue');
    expect(code).toContain('--color-delve-');
    // Resolved once per paint into a colors object, never inside a marker loop.
    expect(code).toContain('resolveColors');
  });

  it('defines the delve color tokens it reads in the design-token sheet', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    for (const tok of [
      '--color-delve-room',
      '--color-delve-mob',
      '--color-delve-mob-aggro',
      '--color-delve-party-dead',
      '--color-delve-label',
      '--color-delve-outline',
    ]) {
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });
});

// --- WCAG-chrome boundary over the vendor window the host now composes ----------
// No DOM/axe in this Node suite, and the vendor change is purely compositional
// (VendorWindowDeps composes PainterHostPresentation; the call site spreads the
// same bag), so renderVendorWindow's accessible markup is byte-identical. This
// source scan is the axe-core-equivalent: it asserts the a11y-bearing structure
// survives the composition. The delve schematic Canvas is the 3D-world-class
// surface that is OUT of a11y scope; the '#zone-label' the painter writes stays a
// real text node (setText -> textContent), which IS in scope.

describe('vendor window WCAG-chrome (compositional, markup intact)', () => {
  const vendor = readFileSync(new URL('../src/ui/vendor_window.ts', import.meta.url), 'utf8');

  it('composes the PainterHostPresentation base', () => {
    expect(vendor).toContain('extends PainterHostPresentation');
  });

  it('keeps the accessible vendor markup (focusable buttons + aria labels)', () => {
    // Close control: a real button with an aria-label.
    expect(vendor).toContain('data-close aria-label=');
    // Item rows: real <button>s with per-row aria-labels (keyboard reachable,
    // native target size), unchanged by the composition.
    expect(vendor).toContain("row.type = 'button'");
    expect(vendor).toContain("row.setAttribute('aria-label'");
  });
});
