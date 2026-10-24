import { describe, expect, it, vi } from 'vitest';
import { ActionBarController } from '../src/ui/hud/action_bar/action_bar_controller';

describe('spectator action-bar isolation', () => {
  it('freezes druid forms, input profiles and the custom attack slot while watching', () => {
    let readOnly = false;
    let profile: 'desktop' | 'touch' = 'desktop';
    const auras = new Set<string>();
    const data = new Map<string, string>();
    const persistLayout = vi.fn();
    const controller = new ActionBarController({
      storage: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          data.set(key, value);
        },
        removeItem: (key) => {
          data.delete(key);
        },
      },
      playerClass: 'druid',
      playerName: 'Owner',
      playerLevel: () => 20,
      knownAbilityIds: () => [],
      talentSpec: () => 'feral',
      hasAura: (kind) => auras.has(kind),
      showAttackButton: () => false,
      readOnly: () => readOnly,
      profile: () => profile,
      persistLayout,
    });
    controller.init();
    controller.replaceAttackAction({ type: 'item', id: 'healing_potion' });
    controller.saveAttackAction();
    const attack = controller.attackAction;
    const before = JSON.stringify([...data]);
    readOnly = true;
    profile = 'touch';
    for (const form of ['form_bear', 'form_cat', 'stealth']) {
      auras.add(form);
      controller.syncActiveForm();
      expect(controller.activeForm).toBe('normal');
      auras.delete(form);
    }
    controller.syncProfile();
    expect(controller.profile).toBe('desktop');
    controller.replaceAttackAction(null);
    controller.saveAttackAction();
    expect(controller.attackAction).toEqual(attack);
    expect(JSON.stringify([...data])).toBe(before);
    readOnly = false;
    auras.add('form_bear');
    expect(controller.syncActiveForm()).toBe(true);
    expect(controller.activeForm).toBe('bear');
    expect(controller.syncProfile()).toBe(true);
    expect(controller.profile).toBe('touch');
  });
  it('preserves slots, form, spec and storage until the owner snapshot is ready', () => {
    const data = new Map<string, string>();
    let readOnly = false;
    let known = ['fireball', 'frostbolt'];
    let spec: string | null = 'fire';
    const persistLayout = vi.fn();
    const controller = new ActionBarController({
      storage: {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
        removeItem: (k) => {
          data.delete(k);
        },
      },
      playerClass: 'mage',
      playerName: 'Owner',
      playerLevel: () => 20,
      knownAbilityIds: () => known,
      talentSpec: () => spec,
      hasAura: () => false,
      showAttackButton: () => true,
      readOnly: () => readOnly,
      persistLayout,
    });
    controller.init();
    controller.replaceActions([
      { type: 'ability', id: 'frostbolt' },
      { type: 'ability', id: 'fireball' },
    ]);
    controller.saveActions();
    const before = JSON.stringify([...data]);
    const slots = [...controller.actions];
    persistLayout.mockClear();
    readOnly = true;
    known = ['sinister_strike'];
    spec = 'combat';
    controller.syncProfile();
    controller.syncSpec();
    controller.syncActiveForm();
    controller.syncKnownAbilities();
    controller.resetActiveBar();
    controller.replaceActions([]);
    controller.saveActions();
    expect(controller.actions).toEqual(slots);
    expect(controller.activeSpec).toBe('fire');
    expect(JSON.stringify([...data])).toBe(before);
    expect(persistLayout).not.toHaveBeenCalled();
    known = ['fireball', 'frostbolt'];
    spec = 'fire';
    readOnly = false;
    controller.syncSpec();
    controller.syncKnownAbilities();
    expect(controller.actions.slice(0, 2)).toEqual(slots.slice(0, 2));
  });
});
