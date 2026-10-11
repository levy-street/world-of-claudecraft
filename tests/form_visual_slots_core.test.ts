// The form-rig slot list the renderer's per-frame passes walk
// (src/render/characters/form_visual_slots_core.ts). Pins the slot set, the
// asset-key mapping, and that every pass reaches every slot, the new
// Sporemender rig included, while only the ACTIVE rig may go far or carry the
// proxy shadow.
import { describe, expect, it } from 'vitest';
import {
  disposeFormRigs,
  FORM_VISUAL_SLOTS,
  type FormSlotRig,
  type FormVisualSlots,
  setFormRigsFar,
  setFormRigsProxyShadow,
  setFormRigsShadow,
  visibleFormRig,
} from '../src/render/characters/form_visual_slots_core';

interface StubRig extends FormSlotRig {
  name: string;
  shadow: boolean | null;
  far: boolean | null;
  proxy: boolean | null;
  disposed: boolean;
}

function stub(name: string, visible = false): StubRig {
  return {
    name,
    root: { visible },
    shadow: null,
    far: null,
    proxy: null,
    disposed: false,
    setShadow(on) {
      this.shadow = on;
    },
    setFar(on) {
      this.far = on;
    },
    setProxyShadow(on) {
      this.proxy = on;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function allSlots(): FormVisualSlots<StubRig> {
  return {
    sheepVisual: stub('sheep'),
    bearVisual: stub('bear'),
    catVisual: stub('cat'),
    travelVisual: stub('travel'),
    metamorphVisual: stub('metamorph'),
    sporemenderVisual: stub('sporemender'),
  };
}

describe('form visual slots', () => {
  it('names every lazy form rig', () => {
    expect([...FORM_VISUAL_SLOTS]).toEqual([
      'sheepVisual',
      'bearVisual',
      'catVisual',
      'travelVisual',
      'metamorphVisual',
      'sporemenderVisual',
    ]);
  });

  it('sets the articulated shadow on every built rig and skips empty slots', () => {
    const v = allSlots();
    v.catVisual = null;
    setFormRigsShadow(v, true);
    for (const slot of FORM_VISUAL_SLOTS) {
      if (slot === 'catVisual') expect(v[slot]).toBeNull();
      else expect(v[slot]?.shadow).toBe(true);
    }
  });

  it('lets only the active rig go far or carry the proxy shadow', () => {
    const v = allSlots();
    const active = v.sporemenderVisual;
    setFormRigsFar(v, active, true);
    setFormRigsProxyShadow(v, active, true);
    for (const slot of FORM_VISUAL_SLOTS) {
      const isActive = slot === 'sporemenderVisual';
      expect(v[slot]?.far).toBe(isActive);
      expect(v[slot]?.proxy).toBe(isActive);
    }
    setFormRigsFar(v, active, false);
    setFormRigsProxyShadow(v, active, false);
    expect(v.sporemenderVisual?.far).toBe(false);
    expect(v.sporemenderVisual?.proxy).toBe(false);
  });

  it('reports the drawn form rig, or null when the base body shows', () => {
    const v = allSlots();
    expect(visibleFormRig(v)).toBeNull();
    v.sporemenderVisual = stub('sporemender', true);
    expect(visibleFormRig(v)?.name).toBe('sporemender');
  });

  it('disposes every built rig', () => {
    const v = allSlots();
    disposeFormRigs(v);
    for (const slot of FORM_VISUAL_SLOTS) expect(v[slot]?.disposed).toBe(true);
  });
});
