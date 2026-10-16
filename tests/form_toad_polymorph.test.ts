// The Toad Hex's toad (src/render/characters/form_visual_selection_core.ts,
// form_rig_sync.ts): a polymorph is one form slot behind one gate, and the
// Sunbone Hexcaller's hex wears a toad in it, never the sheep. A slot left
// holding the other animal (a sheep from an earlier Polymorph) is disposed
// and rebuilt, so the right animal shows.
import { describe, expect, it, type Mock, vi } from 'vitest';
import { type FormRigBuild, syncFormRig } from '../src/render/characters/form_rig_sync';
import {
  characterFormAssetKey,
  characterFormMaskForAura,
  characterFormReadyMask,
  polymorphRigStale,
  requestedCharacterForm,
  resolvedCharacterForm,
  TOAD_POLYMORPH_AURAS,
} from '../src/render/characters/form_visual_selection_core';
import { VISUALS } from '../src/render/characters/manifest';
import { settlePendingSwap } from '../src/render/compile_gate';
import { WILDHEART_TOADED } from '../src/sim/mob/trash_kit/wildheart_cast_ids';

const TOADED = { kind: 'polymorph', id: WILDHEART_TOADED };
const SHEEPED = { kind: 'polymorph', id: 'polymorph' };

function rig(assetKey: string) {
  return { assetKey, dispose: vi.fn() };
}

function view() {
  return {
    sheepVisual: null as ReturnType<typeof rig> | null,
    bearVisual: null as ReturnType<typeof rig> | null,
    catVisual: null as ReturnType<typeof rig> | null,
    travelVisual: null as ReturnType<typeof rig> | null,
    metamorphVisual: null as ReturnType<typeof rig> | null,
  };
}

describe('the toad hex wears a toad', () => {
  it('rides the polymorph slot (one gate, one stand-in)', () => {
    expect(TOAD_POLYMORPH_AURAS.has(WILDHEART_TOADED)).toBe(true);
    expect(requestedCharacterForm(characterFormMaskForAura(TOADED))).toBe('sheep');
  });

  it('resolves the toad asset for the hex and the sheep for any other polymorph', () => {
    expect(characterFormAssetKey('form_sheep', [TOADED])).toBe('form_toad');
    expect(characterFormAssetKey('form_sheep', [SHEEPED])).toBe('form_sheep');
    expect(characterFormAssetKey('form_sheep', [])).toBe('form_sheep');
    // The toad hex id on a non-polymorph kind never turns the slot.
    expect(characterFormAssetKey('form_sheep', [{ kind: 'slow', id: WILDHEART_TOADED }])).toBe(
      'form_sheep',
    );
    // Only the polymorph slot reads it; the shaman wolf split still holds.
    expect(characterFormAssetKey('form_bear', [TOADED])).toBe('form_bear');
    expect(characterFormAssetKey('form_cat', [{ kind: 'buff_speed', id: 'ghost_wolf' }])).toBe(
      'form_ghost_wolf',
    );
  });

  it("ships a toad visual: the Spore Toad's own body, squat at a player knee", () => {
    const toad = VISUALS.form_toad;
    expect(toad).toBeDefined();
    expect(toad?.url).toBe(VISUALS.wildheart_spore_toad?.url);
    expect(toad?.authoredAtlas).toBe(true);
    expect(toad?.height ?? 99).toBeLessThan(2.6);
    expect(toad?.height ?? 0).toBeGreaterThan(VISUALS.form_sheep?.height ?? 99);
  });

  it('calls a sheep rig stale under the hex and a toad rig stale under a Polymorph', () => {
    expect(polymorphRigStale('form_sheep', [TOADED])).toBe(true);
    expect(polymorphRigStale('form_toad', [SHEEPED])).toBe(true);
    expect(polymorphRigStale('form_toad', [TOADED])).toBe(false);
    expect(polymorphRigStale('form_sheep', [SHEEPED])).toBe(false);
  });
});

describe('syncFormRig builds the requested form rig', () => {
  it('builds an empty slot for the requested form, gated', () => {
    const v = view();
    const build = vi.fn();
    const e = { auras: [TOADED] };
    syncFormRig(e, v, 'sheep', build);
    expect(build).toHaveBeenCalledWith(e, v, 'form_sheep', 'sheepVisual', true);
  });

  it('disposes a sheep left in the slot and rebuilds it for the toad', () => {
    const v = view();
    const sheep = rig('form_sheep');
    v.sheepVisual = sheep;
    const build = vi.fn();
    syncFormRig({ auras: [TOADED] }, v, 'sheep', build);
    expect(sheep.dispose).toHaveBeenCalledTimes(1);
    expect(v.sheepVisual).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[3]).toBe('sheepVisual');
  });

  it('keeps a slot already holding the right animal', () => {
    const v = view();
    const toad = rig('form_toad');
    v.sheepVisual = toad;
    const build = vi.fn();
    syncFormRig({ auras: [TOADED] }, v, 'sheep', build);
    expect(toad.dispose).not.toHaveBeenCalled();
    expect(v.sheepVisual).toBe(toad);
    expect(build).not.toHaveBeenCalled();
  });

  it('builds every other form as before, and nothing for base or the fireball', () => {
    const build = vi.fn();
    const e = { auras: [] };
    syncFormRig(e, view(), 'bear', build);
    syncFormRig(e, view(), 'cat', build);
    syncFormRig(e, view(), 'travel', build);
    syncFormRig(e, view(), 'metamorph', build);
    syncFormRig(e, view(), 'base', build);
    syncFormRig(e, view(), 'fireball', build);
    expect(build.mock.calls.map((c) => [c[2], c[3], c[4]])).toEqual([
      ['form_bear', 'bearVisual', true],
      ['form_cat', 'catVisual', true],
      ['form_travel', 'travelVisual', true],
      ['form_metamorph', 'metamorphVisual', false],
    ]);
    // A built bear is never rebuilt (the stale check is the polymorph slot's).
    const v = view();
    v.bearVisual = rig('form_sheep');
    const again = vi.fn();
    syncFormRig(e, v, 'bear', again);
    expect(again).not.toHaveBeenCalled();
  });
});

// The renderer's entity loop, reduced to its form arm: syncFormRig, then the
// ready mask over the slots and the shared pending-root token, then the
// resolved form (renderer.ts, in that order). The build mirrors
// buildFormVisual: the new rig takes its slot at once and its root becomes the
// pending token until its compile gate settles (settlePendingSwap).
describe('a stale polymorph rig rebuild keeps the body standing in', () => {
  interface GatedRig {
    assetKey: string;
    root: object;
    dispose: Mock<() => void>;
  }
  type GatedView = { [K in keyof ReturnType<typeof view>]: GatedRig | null } & {
    formCompilePending: object | null;
  };

  function gatedView(): GatedView {
    return {
      sheepVisual: null,
      bearVisual: null,
      catVisual: null,
      travelVisual: null,
      metamorphVisual: null,
      formCompilePending: null,
    };
  }

  function gatedRig(assetKey: string): GatedRig {
    return { assetKey, root: { name: assetKey }, dispose: vi.fn<() => void>() };
  }

  /** A gated build: the rig's root is pending until its `settle` runs. */
  function gatedBuild(fail = false) {
    const settles: Array<() => void> = [];
    const built: GatedRig[] = [];
    const build: FormRigBuild<{ auras: { kind: string; id?: string }[] }, GatedView> = (
      e,
      v,
      formKey,
      slot,
      gate,
    ) => {
      if (fail) return;
      const rig = gatedRig(characterFormAssetKey(formKey, e.auras));
      built.push(rig);
      v[slot] = rig;
      if (!gate) return;
      v.formCompilePending = rig.root;
      settles.push(() => {
        v.formCompilePending = settlePendingSwap(v.formCompilePending, rig.root);
      });
    };
    return { build, settles, built };
  }

  function resolve(v: GatedView, auras: { kind: string; id?: string }[]) {
    let mask = 0;
    for (const a of auras) mask |= characterFormMaskForAura(a);
    const requested = requestedCharacterForm(mask);
    const ready = characterFormReadyMask(
      v.sheepVisual,
      v.bearVisual,
      v.catVisual,
      v.travelVisual,
      v.metamorphVisual,
      v.formCompilePending,
    );
    return resolvedCharacterForm(requested, ready);
  }

  it('resolves base while the toad links over a ready sheep, then the toad', () => {
    const v = gatedView();
    const sheep = gatedRig('form_sheep');
    v.sheepVisual = sheep;
    // The sheep from an earlier Polymorph had linked: it drew as the sheep.
    expect(resolve(v, [SHEEPED])).toBe('sheep');

    const { build, settles, built } = gatedBuild();
    const e = { auras: [TOADED] };
    syncFormRig(e, v, requestedCharacterForm(characterFormMaskForAura(TOADED)), build);
    expect(sheep.dispose).toHaveBeenCalledTimes(1);
    expect(built.map((r) => r.assetKey)).toEqual(['form_toad']);
    expect(v.sheepVisual).toBe(built[0]);
    // The disposed sheep never draws under the hex, and the toad is behind its
    // gate: the body stands in.
    expect(resolve(v, e.auras)).toBe('base');
    // A later frame before the settle: no second rebuild, still the body.
    syncFormRig(e, v, 'sheep', build);
    expect(built).toHaveLength(1);
    expect(resolve(v, e.auras)).toBe('base');

    settles[0]();
    expect(v.formCompilePending).toBeNull();
    expect(resolve(v, e.auras)).toBe('sheep');
  });

  it('a late settle of the disposed sheep does not release the toad early', () => {
    const v = gatedView();
    const first = gatedBuild();
    // A Polymorph lands: the sheep is built and is still linking.
    syncFormRig({ auras: [SHEEPED] }, v, 'sheep', first.build);
    const sheep = first.built[0];
    expect(v.formCompilePending).toBe(sheep.root);
    expect(resolve(v, [SHEEPED])).toBe('base');

    // The hex replaces it before the sheep linked: the toad rebuilds.
    const second = gatedBuild();
    syncFormRig({ auras: [TOADED] }, v, 'sheep', second.build);
    expect(sheep.dispose).toHaveBeenCalledTimes(1);
    const toad = second.built[0];
    expect(v.formCompilePending).toBe(toad.root);

    // The sheep's gate settles late: the token stays on the linking toad.
    first.settles[0]();
    expect(v.formCompilePending).toBe(toad.root);
    expect(resolve(v, [TOADED])).toBe('base');

    second.settles[0]();
    expect(resolve(v, [TOADED])).toBe('sheep');
  });

  it('a failed toad build leaves the body, never the disposed sheep', () => {
    const v = gatedView();
    const sheep = gatedRig('form_sheep');
    v.sheepVisual = sheep;
    const { build } = gatedBuild(true);
    syncFormRig({ auras: [TOADED] }, v, 'sheep', build);
    expect(sheep.dispose).toHaveBeenCalledTimes(1);
    expect(v.sheepVisual).toBeNull();
    expect(resolve(v, [TOADED])).toBe('base');
  });
});
