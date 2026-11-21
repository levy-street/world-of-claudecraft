// @vitest-environment happy-dom
// The raid's world markers in the HUD (src/ui/hud/world_markers/): the pure core
// (button view, edit right, where a ground click lands, tile presses, keybind ids),
// the placement aim (the spell aim's surface: arm, steer, commit, cancel, refuse a
// point outside the instance copy, place at the cursor from a hotkey), the
// party-column controller, the keybind registry rows, and the Hud weld (the private
// members the factory reads, and the groundAim seam routing an armed marker).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/icons', () => ({ raidMarkerDataUrl: (s: number) => `data:marker/${s}` }));

import { BIND_ACTIONS } from '../src/game/keybinds';
import { dispatchTargetingAction } from '../src/game/targeting_actions';
import { WORLD_MARKER_RADIUS } from '../src/render/world_markers_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { WorldMarkerAim } from '../src/ui/hud/world_markers/world_marker_aim';
import { WorldMarkersController } from '../src/ui/hud/world_markers/world_markers_controller';
import {
  placedMask,
  WORLD_MARKER_CLEAR_ACTION,
  WORLD_MARKER_PLACE_ACTIONS,
  worldMarkerActionSymbol,
  worldMarkerBarView,
  worldMarkerPress,
  worldMarkerTarget,
} from '../src/ui/hud/world_markers/world_markers_core';
import { bindActionDisplayName } from '../src/ui/keybind_action_names_core';
import type { SharedMapMark } from '../src/world_api';

const HEART = instanceOrigin(DUNGEONS.smith_heart.index, 0);
const CRYPT = instanceOrigin(DUNGEONS.hollow_crypt.index, 1);
const mk = (symbol: number): SharedMapMark => ({
  symbol,
  page: 0,
  x: 0,
  z: 0,
  wx: 0,
  y: 0,
  wz: 0,
});

describe('world markers core', () => {
  it('shows the button in a group inside an instance; edits by the sim rule', () => {
    const base = { playerId: 5, inInstance: true, marks: [], armed: null };
    expect(worldMarkerBarView({ ...base, party: null }).visible).toBe(false);
    expect(worldMarkerBarView({ ...base, party: { leader: 1, raid: false } }).visible).toBe(true);
    expect(
      worldMarkerBarView({ ...base, inInstance: false, party: { leader: 1, raid: false } }).visible,
    ).toBe(false);
    expect(worldMarkerBarView({ ...base, party: { leader: 1, raid: false } }).editable).toBe(true);
    expect(worldMarkerBarView({ ...base, party: { leader: 1, raid: true } }).editable).toBe(false);
    expect(worldMarkerBarView({ ...base, party: { leader: 5, raid: true } }).editable).toBe(true);
    // A read-only player never shows a symbol armed.
    expect(
      worldMarkerBarView({ ...base, armed: 3, party: { leader: 1, raid: true } }).armed,
    ).toBeNull();
  });

  it('keys every painted change into one number', () => {
    const party = { leader: 5, raid: true };
    const a = worldMarkerBarView({ party, playerId: 5, inInstance: true, marks: [], armed: null });
    const b = worldMarkerBarView({
      party,
      playerId: 5,
      inInstance: true,
      marks: [mk(7)],
      armed: null,
    });
    const c = worldMarkerBarView({
      party,
      playerId: 5,
      inInstance: true,
      marks: [mk(7)],
      armed: 0,
    });
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
    expect(placedMask([mk(0), mk(7), mk(9)])).toBe(0b10000001);
  });

  it('puts a ground click on the page and local point of the player copy, refusing anything else', () => {
    const player = { x: HEART.x + 10, z: HEART.z + 20 };
    expect(worldMarkerTarget(player, { x: HEART.x + 12, z: HEART.z + 25 })).toEqual({
      page: 0,
      lx: 12,
      lz: 25,
    });
    // The open world, another dungeon's copy, and a non-finite point are refused.
    expect(worldMarkerTarget({ x: 0, z: 0 }, { x: 1, z: 1 })).toBeNull();
    expect(worldMarkerTarget(player, { x: CRYPT.x, z: CRYPT.z })).toBeNull();
    expect(worldMarkerTarget(player, { x: Number.NaN, z: 0 })).toBeNull();
    // A crypt copy has no atlas: page 0.
    const inCrypt = { x: CRYPT.x + 3, z: CRYPT.z };
    expect(worldMarkerTarget(inCrypt, { x: CRYPT.x + 4, z: CRYPT.z - 6 })?.page).toBe(0);
  });

  it('a tile press arms, disarms, clears one (secondary) or all, and refuses read-only', () => {
    const v = { editable: true, placed: 1 << 2, armed: null };
    expect(worldMarkerPress(v, 4, false)).toEqual({ kind: 'arm', symbol: 4 });
    expect(worldMarkerPress({ ...v, armed: 4 }, 4, false)).toEqual({ kind: 'disarm' });
    expect(worldMarkerPress(v, 2, true)).toEqual({ kind: 'clear', symbol: 2 });
    expect(worldMarkerPress(v, 3, true)).toEqual({ kind: 'refuse' }); // not down
    expect(worldMarkerPress(v, null, false)).toEqual({ kind: 'clear', symbol: null });
    expect(worldMarkerPress({ ...v, placed: 0 }, null, false)).toEqual({ kind: 'refuse' });
    expect(worldMarkerPress({ ...v, editable: false }, 4, false)).toEqual({ kind: 'refuse' });
  });

  it('names the keybind actions, unbound by default and localized', () => {
    expect(WORLD_MARKER_PLACE_ACTIONS).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `worldMarker${n}`),
    );
    expect(worldMarkerActionSymbol('worldMarker1')).toBe(0);
    expect(worldMarkerActionSymbol('worldMarker8')).toBe(7);
    expect(worldMarkerActionSymbol(WORLD_MARKER_CLEAR_ACTION)).toBeNull();
    expect(worldMarkerActionSymbol('worldMarker9')).toBeUndefined();
    for (const id of [...WORLD_MARKER_PLACE_ACTIONS, WORLD_MARKER_CLEAR_ACTION]) {
      const row = BIND_ACTIONS.find((a) => a.id === id);
      expect(row?.defaults, id).toEqual([]);
      expect(row?.kind).toBe('edge');
    }
    expect(bindActionDisplayName('worldMarker8', undefined, () => null)).toBe(
      'Place World Marker: Skull',
    );
    expect(bindActionDisplayName('worldMarkerClear', undefined, () => null)).toBe(
      'Clear All World Markers',
    );
  });

  it('the pad and keyboard targeting arms route the hotkeys to the Hud', () => {
    const hud = { targetOwnPet() {}, worldMarkerHotkey: vi.fn() };
    const world = {} as never;
    expect(dispatchTargetingAction('worldMarker3', world, hud, undefined)).toBe(true);
    expect(dispatchTargetingAction('worldMarkerClear', world, hud, undefined)).toBe(true);
    expect(hud.worldMarkerHotkey.mock.calls).toEqual([[2], [null]]);
  });
});

function aimRig() {
  const pos = { x: HEART.x + 10, y: 4, z: HEART.z + 20 };
  const place = vi.fn();
  const clearReticle = vi.fn();
  const changed = vi.fn();
  const aim = new WorldMarkerAim({ player: () => ({ pos }), place, clearReticle, changed });
  return { aim, pos, place, clearReticle, changed };
}

describe('world marker aim', () => {
  it('speaks the spell aim surface and places where the ground was clicked', () => {
    const { aim, place, clearReticle } = aimRig();
    expect(aim.isActive()).toBe(false);
    expect(aim.commitAt({ x: 0, z: 0 })).toBe(false);
    aim.begin(6);
    expect(aim.activeSlot()).toBeNull();
    expect(aim.activeAbilityId()).toBeNull();
    aim.updatePoint({ x: HEART.x + 14, z: HEART.z + 18 });
    expect(aim.reticle()).toEqual({
      point: { x: HEART.x + 14, z: HEART.z + 18 },
      radius: WORLD_MARKER_RADIUS,
      school: 'physical',
      dimmed: false,
      blocked: false,
      marker: 6,
    });
    expect(aim.commitAt({ x: HEART.x + 14, z: HEART.z + 18 })).toBe(true);
    expect(place).toHaveBeenCalledWith(0, HEART.x + 14, 4, HEART.z + 18, 6);
    expect(aim.isActive()).toBe(false);
    expect(clearReticle).toHaveBeenCalled();
  });

  it('shows a point outside the copy as refused and keeps waiting for a good click', () => {
    const { aim, place } = aimRig();
    aim.begin(1);
    aim.updatePoint({ x: 5, z: 5 });
    expect(aim.reticle()?.blocked).toBe(true);
    expect(aim.commitAt({ x: 5, z: 5 })).toBe(true);
    expect(place).not.toHaveBeenCalled();
    expect(aim.isActive()).toBe(true);
  });

  it('cancels (right click, Escape, the button), and a hotkey places at the next cursor point', () => {
    const { aim, place, changed } = aimRig();
    aim.begin(2);
    expect(aim.cancel()).toBe(true);
    expect(aim.cancel()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    aim.begin(3, true);
    aim.updatePoint({ x: HEART.x + 1, z: HEART.z + 2 });
    expect(place).toHaveBeenCalledWith(0, HEART.x + 1, 4, HEART.z + 2, 3);
    expect(aim.isActive()).toBe(false);
  });

  it('leashes pad steering to its range round the player', () => {
    const { aim, pos } = aimRig();
    aim.begin(0);
    aim.nudge(500, 0);
    const p = aim.rawAimPoint();
    expect(Math.hypot((p?.x ?? 0) - pos.x, (p?.z ?? 0) - pos.z)).toBeCloseTo(
      aim.abilityRange() ?? 0,
      6,
    );
  });
});

describe('world markers controller', () => {
  function rig(party: { leader: number; raid: boolean } | null, marks: SharedMapMark[] = []) {
    const pos = { x: HEART.x + 10, y: 4, z: HEART.z + 20 };
    const world = {
      partyInfo: party ? { ...party, members: [], master: {} } : null,
      playerId: 5,
      player: { pos },
      sharedMapMarks: () => marks,
      clearSharedMapMarks: vi.fn(),
    };
    const aim = new WorldMarkerAim({
      player: () => ({ pos }),
      place: vi.fn(),
      clearReticle: () => {},
      changed: () => {},
    });
    const writers = {
      setText: (el: HTMLElement, v: string) => {
        el.textContent = v;
      },
      setDisplay: () => {},
      setTransform: () => {},
      setWidth: () => {},
      setStyleProp: () => {},
      toggleClass: (el: HTMLElement, c: string, on: boolean) => el.classList.toggle(c, on),
      setAttr: (el: HTMLElement, n: string, v: string | null) =>
        v === null ? el.removeAttribute(n) : el.setAttribute(n, v),
    };
    const cancelSpellAim = vi.fn();
    const c = new WorldMarkersController({
      doc: document,
      writers,
      world: () => world as never,
      aim,
      cancelSpellAim,
      attachTooltip: () => {},
      keyLabel: (id) => (id === 'worldMarker8' ? 'Shift+8' : ''),
      isTouch: () => false,
    });
    return { c, aim, world, cancelSpellAim };
  }
  const tile = (root: HTMLElement, s: number) =>
    root.querySelector(`[data-symbol="${s}"]`) as HTMLButtonElement;

  it('hides out of a group, shows in one, and lights the placed symbols', () => {
    expect(rig(null).c.sync()).toBeNull();
    const { c } = rig({ leader: 5, raid: true }, [mk(7)]);
    const root = c.sync();
    expect(root).not.toBeNull();
    expect(tile(c.root, 7).classList.contains('is-placed')).toBe(true);
    expect(tile(c.root, 0).classList.contains('is-placed')).toBe(false);
  });

  it('a tile click arms that symbol (closing the flyout), a right click clears it', () => {
    const { c, aim, world, cancelSpellAim } = rig({ leader: 5, raid: false }, [mk(7)]);
    c.sync();
    (c.root.querySelector('.party-world-markers-button') as HTMLButtonElement).click();
    expect(c.isOpen()).toBe(true);
    tile(c.root, 4).click();
    expect(aim.armed()).toBe(4);
    expect(cancelSpellAim).toHaveBeenCalled();
    expect(c.isOpen()).toBe(false);
    tile(c.root, 7).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(world.clearSharedMapMarks).toHaveBeenCalledWith(7);
  });

  it('a raid member who is not the leader cannot open it or arm', () => {
    const { c, aim } = rig({ leader: 1, raid: true });
    c.sync();
    expect(c.root.classList.contains('is-read-only')).toBe(true);
    (c.root.querySelector('.party-world-markers-button') as HTMLButtonElement).click();
    expect(c.isOpen()).toBe(false);
    c.hotkey(2);
    expect(aim.isActive()).toBe(false);
  });

  it('shows each bound key in its tile when the flyout opens', () => {
    const { c } = rig({ leader: 5, raid: false });
    c.sync();
    (c.root.querySelector('.party-world-markers-button') as HTMLButtonElement).click();
    expect(tile(c.root, 7).querySelector('.party-world-markers-tile-key')?.textContent).toBe(
      'Shift+8',
    );
  });
});

describe('the Hud weld', () => {
  const hud = readFileSync(join(__dirname, '..', 'src', 'ui', 'hud.ts'), 'utf8');
  it('declares every private member the factory reads', () => {
    for (const member of [
      'sim',
      'writerFacet',
      'keybinds',
      'renderer',
      'playerGroundAim',
      'attachTooltip',
    ])
      expect(hud, member).toMatch(new RegExp(`\\b${member}\\b`));
  });

  it('routes an armed marker through the one groundAim seam and seats the control', () => {
    expect(hud).toContain('this.worldMarkers.aimOr(spell)');
    expect(hud).toContain(
      'this.partyFramesPainter.setWorldMarkerControl(this.worldMarkers.controller.sync())',
    );
    expect(hud).toContain('worldMarkerHotkey(symbol: number | null): void');
  });
});
