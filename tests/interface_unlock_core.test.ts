// The pure core behind the "Unlock interface" Interface option
// (src/ui/interface_unlock_core.ts): the frame table, the option row's label
// swap, and the eligibility rule that decides which frames a flip may loosen.
// DOM-free by construction, so this drives the real module directly.
import { describe, expect, it } from 'vitest';
import {
  framesToLock,
  HUD_FRAME_SPECS,
  HUD_FRAME_STORAGE_KEYS,
  interfaceUnlockLabelKey,
  type UnlockCandidate,
} from '../src/ui/interface_unlock_core';

const candidate = (id: string, active: boolean): UnlockCandidate => ({
  id,
  isActive: () => active,
});

describe('HUD_FRAME_SPECS', () => {
  it('covers exactly the frames the option promises, each with a unique id, element and key', () => {
    expect(HUD_FRAME_SPECS.map((s) => s.id)).toEqual([
      'actionBar1',
      'actionBar2',
      'actionBar3',
      'actionBarGroup',
      'castBar',
      'swingBar',
      'steamWishlist',
      'menu',
      'minimap',
      'petFrame',
      'stanceBar',
      'xpBar',
      'buffBar',
      'debuffBar',
    ]);
    expect(HUD_FRAME_SPECS.map((s) => s.elementId)).toEqual([
      'actionbar',
      'actionbar2',
      'actionbar3',
      'actionbar-group',
      'castbar',
      'swingbar',
      'community-hud',
      'side-buttons',
      'minimap-wrap',
      'pet-frame',
      'stancebar',
      'xpbar',
      'buff-bar',
      'debuff-bar',
    ]);
    // A duplicated storage key would make two frames overwrite each other's
    // saved box, which is silent and only shows up after a reload.
    expect(new Set(HUD_FRAME_STORAGE_KEYS).size).toBe(HUD_FRAME_SPECS.length);
    // The FULL key list, pinned as literals in spec order: these are persisted
    // player data (localStorage), so renaming any one of them orphans every
    // player's saved layout for that frame with no other test failing. A new
    // frame appends a new key here; an existing key never changes.
    expect(HUD_FRAME_STORAGE_KEYS).toEqual([
      'woc_hud_frame_actionbar',
      'woc_hud_frame_actionbar2',
      'woc_hud_frame_actionbar3',
      'woc_hud_frame_actionbar_group',
      'woc_hud_frame_castbar',
      'woc_hud_frame_swingbar',
      'woc_hud_frame_community',
      'woc_hud_frame_side_buttons',
      'woc_hud_frame_minimap',
      'woc_hud_frame_pet',
      'woc_hud_frame_stancebar',
      'woc_hud_frame_xpbar',
      'woc_hud_frame_buffbar',
      'woc_hud_frame_debuffbar',
    ]);
  });

  it('marks exactly the frames that can sit under a transformed ancestor for re-homing', () => {
    // The action bars, pet frame and XP bar live inside #bottom-bar, whose
    // centering transform becomes the containing block for absolute positioning;
    // the buff/debuff rows can be re-parented into the player frame at runtime
    // (auras-on-frame). The cast bar, menu rail and minimap are already #ui
    // children, and the detacher is a no-op for a frame already homed there.
    const detaching = HUD_FRAME_SPECS.filter((s) => s.detachToUiRoot).map((s) => s.id);
    expect(detaching).toEqual([
      'actionBar1',
      'actionBar2',
      'actionBar3',
      'actionBarGroup',
      'petFrame',
      'stanceBar',
      'xpBar',
      'buffBar',
      'debuffBar',
    ]);
  });

  it('reserves box (layout) resize for the frames that genuinely reflow', () => {
    // Everything else is fixed content (46px slots, a minimap canvas, a
    // portrait), where stretching one axis only grew empty space.
    const box = HUD_FRAME_SPECS.filter((s) => s.resizeMode === 'box').map((s) => s.id);
    expect(box).toEqual(['buffBar', 'debuffBar']);
  });

  it('names every frame with a label key so no placeholder is anonymous', () => {
    for (const spec of HUD_FRAME_SPECS) {
      expect(spec.labelKey, `frame ${spec.id} has no name chip key`).toBeTruthy();
    }
  });

  it('gives every frame a positive fallback size for the hidden-frame clamp', () => {
    for (const spec of HUD_FRAME_SPECS) {
      expect(spec.fallbackSize.w).toBeGreaterThan(0);
      expect(spec.fallbackSize.h).toBeGreaterThan(0);
    }
  });
});

describe('interfaceUnlockLabelKey', () => {
  it('names the action the press performs, not the current state', () => {
    expect(interfaceUnlockLabelKey(false)).toBe('hudChrome.interfaceUnlock.unlock');
    expect(interfaceUnlockLabelKey(true)).toBe('hudChrome.interfaceUnlock.lock');
  });
});

describe('framesToLock', () => {
  it('unlocks only the frames that are live right now', () => {
    const decisions = framesToLock(
      [candidate('actionBar1', true), candidate('petFrame', false), candidate('castBar', true)],
      true,
    );
    expect(decisions).toEqual([
      { id: 'actionBar1', unlocked: true },
      // A hunter with no pet out cannot move the pet frame.
      { id: 'petFrame', unlocked: false },
      { id: 'castBar', unlocked: true },
    ]);
  });

  it('locks every frame unconditionally, including ones that went inactive', () => {
    // The pet was dismissed while the interface was unlocked: the frame must
    // still be told to lock, or its drag gesture stays armed behind a hidden
    // element and fires the next time the pet is summoned.
    const decisions = framesToLock(
      [candidate('actionBar1', true), candidate('petFrame', false)],
      false,
    );
    expect(decisions).toEqual([
      { id: 'actionBar1', unlocked: false },
      { id: 'petFrame', unlocked: false },
    ]);
  });

  it('preserves registration order and reports one decision per candidate', () => {
    const ids = HUD_FRAME_SPECS.map((s) => s.id);
    const decisions = framesToLock(
      ids.map((id) => candidate(id, true)),
      true,
    );
    expect(decisions.map((d) => d.id)).toEqual(ids);
    expect(decisions.every((d) => d.unlocked)).toBe(true);
  });

  it('returns nothing when no frame is registered', () => {
    expect(framesToLock([], true)).toEqual([]);
  });
});
