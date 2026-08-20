import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { farMeshShown } from '../src/render/characters/far_lod_reveal_core';
import {
  characterFormReadyMask,
  characterFormVisibility,
  requestedCharacterForm,
  resolvedCharacterForm,
} from '../src/render/characters/form_visual_selection_core';
import {
  anyCharacterRigDrawing,
  applyCharacterFormVisibility,
  ENTITY_GATE_STAND_INS,
  type EntityGateStandIn,
  entityHasNoBody,
} from '../src/render/entity_gate_stand_in_core';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';
import { NAMEPLATE_RANGE, nameplatePlanInto, newNameplatePlan } from '../src/render/nameplate_view';

// THE INVERSE INVARIANT of the live compile gates: never leave an entity with
// no representation. A gate exists so a still-linking program is not drawn; it
// is only fair while SOMETHING else still tells the player the entity is there
// (the link is not cancellable and the gate timeout is diagnostic only, so the
// window is unbounded). Every gate call site names its stand-in in
// ENTITY_GATE_STAND_INS, this file drives that stand-in, and the coverage pin
// below reds on any gate call site that has not registered one.

const sourceOf = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * Where each gate's call sites live, and the text that IS a call site there.
 * The scan below is only as wide as this table, so a gate shape missing from
 * it is a gate nobody has to register: the case after it diffs the table
 * against the gate names the registry uses, both ways.
 *
 * `spiritCompileGate` is the one that is not a renderer wrapper. The puppet
 * pool takes the host's gate through `setSpiritCompileGate` and consults it in
 * its own spawn, so the call site is that consult.
 */
const GATE_CALL_SITES: readonly {
  gate: EntityGateStandIn['gate'];
  file: string;
  marker: string;
}[] = [
  {
    gate: 'gateViewOnCompile',
    file: 'src/render/renderer.ts',
    marker: 'this.gateViewOnCompile(',
  },
  {
    gate: 'gateSwapOnCompile',
    file: 'src/render/renderer.ts',
    marker: 'this.gateSwapOnCompile(',
  },
  {
    gate: 'gateSwapFlagOnCompile',
    file: 'src/render/renderer.ts',
    marker: 'this.gateSwapFlagOnCompile(',
  },
  {
    gate: 'spiritCompileGate',
    file: 'src/render/ability_vfx/spirits.ts',
    marker: 'this.compileGate && !puppet.compiled',
  },
];

/**
 * The gate wrapper names renderer.ts actually uses, DERIVED from the source
 * rather than hand-listed: comments come out first (so prose naming a gate is
 * not a call site), then every `gate*OnCompile` identifier that is left is a
 * live wrapper. A brand-new `gateFooOnCompile` in renderer.ts therefore lands
 * in this set with no registry row and reds the case below, which two
 * hand-maintained lists could not catch.
 */
function deriveRendererGateNames(source: string): Set<string> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return new Set([...code.matchAll(/\bgate\w*OnCompile\b/g)].map((m) => m[0]));
}

function rig(visible: boolean): { root: { visible: boolean }; setActive(on: boolean): void } {
  const node = {
    root: { visible },
    setActive(on: boolean) {
      node.root.visible = on;
    },
  };
  return node;
}

function slots(overrides: Record<string, unknown> = {}) {
  return {
    visual: null,
    sheepVisual: null,
    bearVisual: null,
    catVisual: null,
    travelVisual: null,
    metamorphVisual: null,
    fireballTravelVisual: null,
    ...overrides,
  } as never;
}

describe('entity gate stand-in registry', () => {
  it('names a stand-in for every registered gate call site', () => {
    expect(ENTITY_GATE_STAND_INS.length).toBeGreaterThan(0);
    for (const row of ENTITY_GATE_STAND_INS) {
      expect(row.standIn.trim(), `${row.gate} stand-in`).not.toBe('');
      expect(row.hides.trim(), `${row.gate} hides`).not.toBe('');
      expect(row.callSite.trim(), `${row.gate} call site`).not.toBe('');
    }
  });

  it('scans every gate shape the registry names, and no phantom one', () => {
    // The scan can only see what GATE_CALL_SITES lists, so a gate shape
    // missing from it would silently need no stand-in at all.
    expect(new Set(GATE_CALL_SITES.map((entry) => entry.gate))).toEqual(
      new Set(ENTITY_GATE_STAND_INS.map((row) => row.gate)),
    );
  });

  it('derives the renderer gate wrappers from the source, so a new one cannot escape', () => {
    // Both lists above are hand-maintained, so a brand-new gate wrapper could
    // be absent from BOTH and be covered by neither. The renderer's wrappers
    // are therefore read out of renderer.ts itself and diffed against the
    // registry: adding gateFooOnCompile there reds this until it has a row.
    const derived = deriveRendererGateNames(sourceOf('src/render/renderer.ts'));
    const registered = new Set(
      ENTITY_GATE_STAND_INS.filter((row) => row.file === 'src/render/renderer.ts').map(
        (row) => row.gate,
      ),
    );
    expect(derived.size).toBeGreaterThan(0);
    expect(
      derived,
      'a gate*OnCompile wrapper in renderer.ts with no ENTITY_GATE_STAND_INS row',
    ).toEqual(registered);
    // ...and the hand-listed scan table agrees with what the source says.
    expect(
      new Set(
        GATE_CALL_SITES.filter((entry) => entry.file === 'src/render/renderer.ts').map(
          (entry) => entry.gate,
        ),
      ),
    ).toEqual(derived);
  });

  it('the gate-name deriver sees new wrappers and ignores prose about them', () => {
    // The deriver is only trustworthy if comments cannot mint a gate and code
    // cannot hide one, so drive it with a synthetic source.
    expect(
      deriveRendererGateNames(
        [
          '// Sibling to gateProseOnCompile, which this comment only talks about.',
          '/* gateBlockCommentOnCompile is likewise just prose. */',
          'const a = this.gateFooOnCompile(node);',
        ].join('\n'),
      ),
    ).toEqual(new Set(['gateFooOnCompile']));
  });

  it('covers every live gate call site (a new gate must register one)', () => {
    for (const { gate, file, marker } of GATE_CALL_SITES) {
      const lines = sourceOf(file).split('\n');
      const callSites = lines.filter((line) => line.includes(marker));
      expect(callSites.length, `${gate} has call sites`).toBeGreaterThan(0);
      const registered = ENTITY_GATE_STAND_INS.filter((row) => row.gate === gate);
      for (const line of callSites) {
        const match = registered.find((row) => line.includes(row.callSite));
        expect(
          match?.standIn,
          `unregistered ${gate} call site (name its stand-in in ENTITY_GATE_STAND_INS): ${line.trim()}`,
        ).toBeTruthy();
      }
      // ...and no row may pin a call site that has been moved or dropped, in
      // a file the scan does not read.
      for (const row of registered) {
        expect(row.file, `${row.callSite} is scanned where it says it lives`).toBe(file);
        expect(
          callSites.some((line) => line.includes(row.callSite)),
          `stale registry row: ${row.callSite}`,
        ).toBe(true);
      }
    }
  });
});

describe('entity gate stand-ins actually stand in', () => {
  it('arrival gate: no body at all, so the nameplate is forced on', () => {
    // The one gate with no in-world stand-in: it hides the whole group, so
    // entityHasNoBody reports true and nameplatePlanInto overrides the toggles.
    expect(entityHasNoBody(true, true, false)).toBe(true);
  });

  it('a character view whose every rig is hidden forces the plate too', () => {
    // The second disjunct on its own: the view is not compile-pending, it has
    // character rigs, and none of them draws (a base swap whose incoming rig
    // is still linking after the outgoing one was torn down, or a form whose
    // stand-in the loop failed to keep). The plate is the last representation.
    expect(entityHasNoBody(false, true, false)).toBe(true);
    // A view without character rigs (a door, a node) is never "bodiless".
    expect(entityHasNoBody(false, false, false)).toBe(false);
  });

  it('shapeshift form gate: the base body draws, so no plate is forced', () => {
    const sheep = rig(false);
    const base = rig(true);
    const requested = requestedCharacterForm(1); // polymorph
    // Built but still linking: the readiness mask holds the resolved form at base.
    const pendingMask = characterFormReadyMask(sheep, null, null, null, null, sheep.root);
    const pending = characterFormVisibility(resolvedCharacterForm(requested, pendingMask));
    const view = slots({ visual: base, sheepVisual: sheep });
    applyCharacterFormVisibility(view, pending, false);
    expect(base.root.visible).toBe(true);
    expect(sheep.root.visible).toBe(false);
    expect(anyCharacterRigDrawing(view)).toBe(true);
    expect(entityHasNoBody(false, true, true)).toBe(false);

    // ...and once it links the sheep takes over and the body steps back.
    const readyMask = characterFormReadyMask(sheep, null, null, null, null, null);
    const ready = characterFormVisibility(resolvedCharacterForm(requested, readyMask));
    applyCharacterFormVisibility(view, ready, false);
    expect(base.root.visible).toBe(false);
    expect(sheep.root.visible).toBe(true);
    expect(anyCharacterRigDrawing(view)).toBe(true);
  });

  it('base-visual swap gate: the outgoing rig is the drawing body', () => {
    const outgoing = rig(true);
    const incoming = rig(true);
    const view = slots({ visual: incoming });
    // The base body is gated by its own swap: applyCharacterFormVisibility hides
    // the incoming rig, and the outgoing one (still parented, see
    // tests/renderer_compile_gate.test.ts) is what the player sees.
    applyCharacterFormVisibility(view, characterFormVisibility('base'), true);
    expect(incoming.root.visible).toBe(false);
    expect(anyCharacterRigDrawing(view)).toBe(false);
    expect(anyCharacterRigDrawing(slots({ visual: outgoing }))).toBe(true);
  });

  it('far-bake gate: the articulated rig stands in until the baked mesh links', () => {
    expect(farMeshShown(true, true, true)).toBe(false); // pending: rig keeps drawing
    expect(farMeshShown(true, true, false)).toBe(true); // settled: mesh takes over
  });

  it('deferred face decals: the body drew from its first frame, the paint alone arrives late', () => {
    // The decals of a body built with them deferred are gated through the far
    // bake gate (visual.ts revealDecalOnCompile hides ONLY the decal meshes);
    // the body is the stand-in, so no plate is forced and the entity has a
    // click target and silhouette the whole time.
    const row = ENTITY_GATE_STAND_INS.find(
      (r) =>
        r.callSite ===
        'this.farBakeLane.enqueue((settled) => this.gateSwapFlagOnCompile(target, settled)',
    );
    expect(row?.hides).toContain('attachDeferredDecals');
    expect(row?.standIn).toContain('the same body');
    const visual = sourceOf('src/render/characters/visual.ts');
    const reveal = visual.slice(
      visual.indexOf('private revealDecalOnCompile('),
      visual.indexOf('\n  }', visual.indexOf('private revealDecalOnCompile(')),
    );
    expect(reveal).toContain('decal.visible = false;');
    expect(reveal).not.toContain('root.visible');
    expect(anyCharacterRigDrawing(slots({ visual: rig(true) }))).toBe(true);
  });

  it('mount and weapon gates: the character keeps drawing throughout', () => {
    // Both hide only an accessory node, never the body, so the rider/wearer is
    // the stand-in and no plate is forced.
    const body = rig(true);
    expect(anyCharacterRigDrawing(slots({ visual: body }))).toBe(true);
    expect(entityHasNoBody(false, true, true)).toBe(false);
  });

  it('spirit gate: the impact sequence plays on without the apparition', () => {
    // The one gate that REFUSES instead of holding: a spirit that pops in late
    // is worse than one that never came. What stands in is the rest of the
    // impact sequence, so the claim to check is that the sequencer's other
    // beats do not depend on the spirit answer.
    const sequencer = sourceOf('src/render/ability_vfx/sequencer.ts');
    const spiritAt = sequencer.indexOf('host.spiritAt?.(');
    expect(spiritAt).toBeGreaterThan(0);
    // Every impact beat above it runs unconditionally; only the apparition's
    // own bookkeeping and its creature call sit inside the guard.
    expect(sequencer.indexOf('this.archetypeImpact(host, slot, gy);')).toBeLessThan(spiritAt);
    expect(sequencer.indexOf('host.shakeAt(')).toBeLessThan(spiritAt);
    expect(
      sequencer.indexOf('if (spec.motifs && slot.tier <= 1) this.runMotifs(host, slot);'),
    ).toBeGreaterThan(spiritAt);
    const guarded = sequencer.slice(spiritAt, sequencer.indexOf('impact-phase motifs', spiritAt));
    expect(guarded).toContain('host.countPrimitive(slot.abilityId, 1);');
    expect(guarded).toContain("host.abilityAudio?.('spirit',");

    // The refusal is silent by construction: spawn just answers false.
    const spirits = sourceOf('src/render/ability_vfx/spirits.ts');
    const refusal = spirits.indexOf('if (this.compileGate && !puppet.compiled) {');
    expect(refusal).toBeGreaterThan(0);
    expect(spirits.slice(refusal, refusal + 400)).toContain('noteSpiritSpawnRefused();');

    // ...and the refusals are readable in a capture rather than invisible.
    resetGpuPrepEventsForTest();
    expect(gpuPrepEventsSnapshot().gates.spiritSpawnsRefused).toBe(0);
  });

  it('arrival gate on an OBJECT view: the plate stands in past the toggles, the range and the object rule', () => {
    // gateViewOnCompile hides the whole group of EVERY non-self view, objects
    // included, and an object owns no rig to fall back on. A gated ground-loot
    // pile would otherwise have no representation at all: plates off hides it
    // by toggle, the plateless-object rule hides it by kind, and the 55 yd
    // nameplate range hides it out to the view-create radius of about 80 yd.
    const player = {
      id: 1,
      kind: 'player',
      pos: { x: 0, y: 0, z: 0 },
      dead: false,
      targetId: null,
      comboPoints: 0,
    } as never;
    const loot = () => ({
      id: 2,
      kind: 'object',
      pos: { x: 0, y: 0, z: NAMEPLATE_RANGE + 20 }, // inside the create radius, outside plate range
      dead: false,
      lootable: true,
      templateId: 'ground_loot',
      dungeonId: null,
      scale: 1,
      overheadEmoteId: null,
      castingAbility: null,
      aggroTargetId: null,
      ownerId: null,
    });
    // An object view has no rigs, so only the arrival gate can make it bodiless.
    const gated = entityHasNoBody(true, false, false);
    const revealed = entityHasNoBody(false, false, false);
    expect(gated).toBe(true);
    expect(revealed).toBe(false);

    const plan = (standIn: boolean) =>
      nameplatePlanInto(
        newNameplatePlan(),
        loot() as never,
        player,
        2,
        false, // mob plates toggled OFF
        false,
        false, // player plates toggled OFF
        standIn,
      );
    expect(plan(gated).hidden, 'a gated object must keep a plate').toBe(false);
    // ...and the moment the gate reveals the pile, the normal rules take it back.
    expect(plan(revealed).hidden, 'a revealed object is plateless again').toBe(true);
  });

  it('counts the bespoke fireball travel body, and leaves rigless object views alone', () => {
    // The Mage travel form takes every rig out of the frame on purpose; its own
    // visual is the body, so it must not trip the forced-plate stand-in.
    expect(anyCharacterRigDrawing(slots({ fireballTravelVisual: {} }))).toBe(true);
    // An object view (door, loot) owns no rig at all: only the arrival gate,
    // which hides its group too, can leave it unrepresented.
    expect(entityHasNoBody(false, false, false)).toBe(false);
  });
});
