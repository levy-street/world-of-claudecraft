// @vitest-environment jsdom
//
// The Cosmetics window painter against a fake IWorld: every action must cross
// the seam exactly once with the right arguments, the tab strip must switch and
// refocus, an unowned card must offer nothing, and a changed snapshot must
// repaint the worn state.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MECH_CHROMAS } from '../src/sim/content/skins';
import { CosmeticsWindow } from '../src/ui/hud/cosmetics/cosmetics_window';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

interface FakeWorld {
  player: {
    templateId: string;
    mainhandItemId: string | null;
    skinCatalog: 'class' | 'mech';
    skin: number;
    mountSkinId: string | null;
  };
  accountCosmetics: {
    completedQuestIds: string[];
    mechChromaIds: string[];
    weaponSkinIds: string[];
    weaponSkinLoadout: Record<string, string>;
    mountSkinIds: string[];
  };
  ownedMounts: () => string[];
  changeMountSkin: ReturnType<typeof vi.fn>;
  changeWeaponSkin: ReturnType<typeof vi.fn>;
  changeSkin: ReturnType<typeof vi.fn>;
  unequipMechChroma: ReturnType<typeof vi.fn>;
}

function fakeWorld(): FakeWorld {
  const world: FakeWorld = {
    player: {
      templateId: 'warrior',
      mainhandItemId: 'worn_sword',
      skinCatalog: 'class',
      skin: 0,
      mountSkinId: null,
    },
    accountCosmetics: {
      completedQuestIds: [],
      mechChromaIds: [MECH_CHROMAS[0].id],
      weaponSkinIds: ['ice_fang_sword', 'glaciersplit_axe'],
      weaponSkinLoadout: {},
      mountSkinIds: ['mech_bird'],
    },
    ownedMounts: () => ['valorsteed'],
    changeMountSkin: vi.fn((id: string | null) => {
      world.player.mountSkinId = id;
    }),
    changeWeaponSkin: vi.fn(),
    changeSkin: vi.fn(),
    unequipMechChroma: vi.fn(),
  };
  return world;
}

function makeWindow(world: FakeWorld): { w: CosmeticsWindow; el: HTMLElement } {
  const el = document.createElement('div');
  el.id = 'cosmetics-window';
  document.body.appendChild(el);
  const w = new CosmeticsWindow({
    root: () => el,
    world: () => world as never,
    closeOthers: vi.fn(),
    hideTooltip: vi.fn(),
    captureFocus: () => null,
    restoreFocus: vi.fn(),
  });
  return { w, el };
}

const card = (el: HTMLElement, id: string): HTMLElement =>
  el.querySelector<HTMLElement>(`[data-card="${id}"]`) as HTMLElement;
const action = (el: HTMLElement, act: string, id?: string): HTMLButtonElement | null =>
  el.querySelector<HTMLButtonElement>(
    `.cos-action[data-act="${act}"]${id ? `[data-id="${id}"]` : ''}`,
  );

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('CosmeticsWindow', () => {
  it('opens on the Mounts tab with every catalog skin, actions only on owned ones', () => {
    const world = fakeWorld();
    const { w, el } = makeWindow(world);
    w.toggle();
    expect(w.isOpen).toBe(true);
    expect(el.querySelectorAll('.cos-tab')).toHaveLength(3);
    expect(el.querySelector('.cos-tab.on')?.getAttribute('data-tab')).toBe('mounts');
    expect(card(el, 'mech_bird')).toBeTruthy();
    expect(card(el, 'chimeglass_tortoise')).toBeTruthy();
    expect(action(el, 'wear-mount', 'mech_bird')).toBeTruthy();
    // Unowned: no action button at all, the store state instead.
    expect(card(el, 'chimeglass_tortoise').querySelector('.cos-action')).toBeNull();
    expect(card(el, 'chimeglass_tortoise').querySelector('.cos-state.store')).toBeTruthy();
    // Scope badges are on every card.
    expect(card(el, 'mech_bird').querySelector('.cos-scope-account')).toBeTruthy();
  });

  it('wears and takes off a mount skin through IWorld exactly once each and repaints', () => {
    const world = fakeWorld();
    const { w, el } = makeWindow(world);
    w.open();
    action(el, 'wear-mount', 'mech_bird')?.click();
    expect(world.changeMountSkin).toHaveBeenCalledTimes(1);
    expect(world.changeMountSkin).toHaveBeenCalledWith('mech_bird');
    // Repainted from the (synchronously mutated) world: now worn, with Take off.
    expect(card(el, 'mech_bird').classList.contains('worn')).toBe(true);
    expect(card(el, 'mech_bird').querySelector('.cos-scope-character')).toBeTruthy();
    action(el, 'takeoff-mount', 'mech_bird')?.click();
    expect(world.changeMountSkin).toHaveBeenCalledTimes(2);
    expect(world.changeMountSkin).toHaveBeenLastCalledWith(null);
    expect(card(el, 'mech_bird').classList.contains('worn')).toBe(false);
  });

  it('applies and detaches weapon skins with the right arguments, gating apply on the held type', () => {
    const world = fakeWorld();
    const { w, el } = makeWindow(world);
    w.open('skins');
    expect(el.querySelector('.cos-tab.on')?.getAttribute('data-tab')).toBe('skins');
    // Holding a sword: the sword skin can apply, the axe skin cannot.
    const applySword = action(el, 'apply-skin', 'ice_fang_sword');
    const applyAxe = action(el, 'apply-skin', 'glaciersplit_axe');
    expect(applySword?.disabled).toBe(false);
    expect(applyAxe?.disabled).toBe(true);
    applyAxe?.click();
    expect(world.changeWeaponSkin).not.toHaveBeenCalled();
    applySword?.click();
    expect(world.changeWeaponSkin).toHaveBeenCalledWith('ice_fang_sword');
    // Once applied (the world mirrors it), the row offers Detach with the type.
    world.accountCosmetics.weaponSkinLoadout = { sword: 'ice_fang_sword' };
    w.refreshIfChanged();
    const detach = action(el, 'detach-skin', 'ice_fang_sword');
    expect(detach?.dataset.type).toBe('sword');
    detach?.click();
    expect(world.changeWeaponSkin).toHaveBeenLastCalledWith(null, 'sword');
  });

  it('wears and takes off a mech chroma through changeSkin / unequipMechChroma', () => {
    const world = fakeWorld();
    const { w, el } = makeWindow(world);
    w.open('mech');
    const id = MECH_CHROMAS[0].id;
    action(el, 'wear-mech', id)?.click();
    expect(world.changeSkin).toHaveBeenCalledWith(0, 'mech');
    world.player.skinCatalog = 'mech';
    world.player.skin = 0;
    w.refreshIfChanged();
    expect(card(el, id).classList.contains('worn')).toBe(true);
    action(el, 'takeoff-mech', id)?.click();
    expect(world.unequipMechChroma).toHaveBeenCalledWith(id);
  });

  it('switches tabs from the strip and shows the empty states', () => {
    const world = fakeWorld();
    world.accountCosmetics.weaponSkinIds = [];
    world.accountCosmetics.mechChromaIds = [];
    const { w, el } = makeWindow(world);
    w.open();
    (el.querySelector('.cos-tab[data-tab="skins"]') as HTMLElement).click();
    expect(el.querySelector('.cos-tab.on')?.getAttribute('data-tab')).toBe('skins');
    expect(el.querySelector('.cos-empty')).toBeTruthy();
    (el.querySelector('.cos-tab[data-tab="mech"]') as HTMLElement).click();
    expect(el.querySelector('.cos-tab.on')?.getAttribute('data-tab')).toBe('mech');
    expect(el.querySelector('.cos-empty')).toBeTruthy();
    // The strip carries the roving tabindex: exactly one focusable tab.
    expect(el.querySelectorAll('.cos-tab[tabindex="0"]')).toHaveLength(1);
  });

  it('hints when the character owns no mount and skips a repaint on an unchanged snapshot', () => {
    const world = fakeWorld();
    world.ownedMounts = () => [];
    const { w, el } = makeWindow(world);
    w.open();
    expect(el.querySelector('.cos-hint')).toBeTruthy();
    const before = el.innerHTML;
    w.refreshIfChanged();
    expect(el.innerHTML).toBe(before);
  });

  it('closes through the corner button and returns focus', () => {
    const world = fakeWorld();
    const { w, el } = makeWindow(world);
    w.open();
    (el.querySelector('[data-close]') as HTMLElement).click();
    expect(w.isOpen).toBe(false);
  });
});
