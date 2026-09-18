// @vitest-environment happy-dom

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BIND_ACTIONS, Keybinds } from '../src/game/keybinds';
import {
  friendlyNameplatesShown,
  resetNameplateViewPrefs,
  toggleFriendlyNameplates,
} from '../src/game/nameplate_view_prefs';
import { isFriendlyNameplateHidden } from '../src/render/nameplate_friendly_core';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { NameplatePickCandidate } from '../src/render/nameplate_pick_core';
import { isMobHostileToViewer } from '../src/render/reaction';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import { BIND_ACTION_LABEL_KEYS } from '../src/ui/keybind_action_names_core';
import type { IWorld } from '../src/world_api';

// Toggle Friendly Nameplates (Ctrl+V): the friendly half of the existing Toggle
// Nameplates key (V). These pin the registry entry and its default chord, the
// pure rule (which plates it owns and everything it must NOT touch, including
// the pet reaction inheritance), and the production painter path, where a
// hidden plate must leave no pick anchor behind either.

const VIEWPORT = { width: 1280, height: 720 };
const VIEWER_ID = 1;

function entity(id: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'mob',
    name: `Add ${id}`,
    templateId: 'cinder_artificer',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: true,
    ownerId: null,
    guild: '',
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
    ...overrides,
  } as unknown as Entity;
}

function mapOf(...list: Entity[]): Map<number, Entity> {
  return new Map(list.map((e) => [e.id, e]));
}

const noHostilePlayers = () => false;

describe('Toggle Friendly Nameplates binding', () => {
  it('ships as an Interface action on Ctrl+V, beside the plain nameplates key', () => {
    const friendly = BIND_ACTIONS.find((a) => a.id === 'friendlyNameplates');
    const all = BIND_ACTIONS.find((a) => a.id === 'nameplates');

    expect(friendly).toBeDefined();
    expect(friendly?.defaults).toEqual(['Ctrl+KeyV']);
    expect(friendly?.kind).toBe('edge');
    expect(friendly?.category).toBe('Interface');
    // The existing key is untouched: the two are separate bindings, and an edge
    // action matches the FULL chord, so Ctrl+V never fires the bare V action.
    expect(all?.defaults).toEqual(['KeyV']);
  });

  it('carries a localized row label, so the Key Bindings panel never prints the id', () => {
    expect(BIND_ACTION_LABEL_KEYS.friendlyNameplates).toBe('hudChrome.keybinds.friendlyNameplates');
  });

  it('resolves Ctrl+V to it and bare V to the all-plates action', () => {
    const binds = new Keybinds();

    expect(binds.actionForCode('Ctrl+KeyV')).toBe('friendlyNameplates');
    expect(binds.actionForCode('KeyV')).toBe('nameplates');
  });
});

describe('friendly nameplate preference', () => {
  beforeEach(() => {
    resetNameplateViewPrefs();
  });

  it('starts shown and flips both ways, so the key is a toggle', () => {
    expect(friendlyNameplatesShown()).toBe(true);
    expect(toggleFriendlyNameplates()).toBe(false);
    expect(friendlyNameplatesShown()).toBe(false);
    expect(toggleFriendlyNameplates()).toBe(true);
    expect(friendlyNameplatesShown()).toBe(true);
  });
});

describe('friendly nameplate rule', () => {
  it('hides nothing at all while the toggle is on, whatever the entity is', () => {
    const wolf = entity(2);
    const npc = entity(3, { hostile: false });
    const other = entity(4, { kind: 'player', hostile: false });
    for (const e of [wolf, npc, other]) {
      expect(isFriendlyNameplateHidden(e, mapOf(e), noHostilePlayers, true)).toBe(false);
    }
  });

  it('hides friendly mob plates when off and leaves hostile ones up', () => {
    const wolf = entity(2);
    const npc = entity(3, { hostile: false });
    const entities = mapOf(wolf, npc);

    expect(isFriendlyNameplateHidden(npc, entities, noHostilePlayers, false)).toBe(true);
    expect(isFriendlyNameplateHidden(wolf, entities, noHostilePlayers, false)).toBe(false);
  });

  it('never touches player plates, object plates, or a corpse', () => {
    const other = entity(4, { kind: 'player', hostile: false });
    const chest = entity(5, { kind: 'object', hostile: false });
    const corpse = entity(6, { dead: true, lootable: true, hostile: false });
    const looted = entity(7, { dead: true, lootable: false, hostile: false });
    const entities = mapOf(other, chest, corpse, looted);

    for (const e of [other, chest, corpse, looted]) {
      expect(isFriendlyNameplateHidden(e, entities, noHostilePlayers, false)).toBe(false);
    }
  });

  it('reads a pet through its owner, so an enemy player pet keeps its plate', () => {
    const enemyPlayer = entity(8, { kind: 'player', hostile: false });
    // The pet's OWN flag says friendly; its hostile owner is what decides.
    const enemyPet = entity(9, { hostile: false, ownerId: enemyPlayer.id });
    const entities = mapOf(enemyPlayer, enemyPet);
    const isHostilePlayer = (p: Entity) => p.id === enemyPlayer.id;

    expect(isMobHostileToViewer(enemyPet, entities, isHostilePlayer)).toBe(true);
    expect(isFriendlyNameplateHidden(enemyPet, entities, isHostilePlayer, false)).toBe(false);
  });

  it('hides a friendly player pet even when its own flag says hostile', () => {
    const friend = entity(10, { kind: 'player', hostile: false });
    const friendlyPet = entity(11, { hostile: true, ownerId: friend.id });
    const entities = mapOf(friend, friendlyPet);

    expect(isMobHostileToViewer(friendlyPet, entities, noHostilePlayers)).toBe(false);
    expect(isFriendlyNameplateHidden(friendlyPet, entities, noHostilePlayers, false)).toBe(true);
  });

  it('falls back to a wild mob own flag when it has no owner', () => {
    const wolf = entity(2);
    const npc = entity(3, { hostile: false });
    const entities = mapOf(wolf, npc);

    expect(isMobHostileToViewer(wolf, entities, noHostilePlayers)).toBe(true);
    expect(isMobHostileToViewer(npc, entities, noHostilePlayers)).toBe(false);
  });
});

function fakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  return {
    setTransform: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxLeft: (text.length * 7) / 2,
      actualBoundingBoxRight: (text.length * 7) / 2,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
  } as unknown as CanvasRenderingContext2D;
}

function view(): EntityView {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  return { group, height: 2, mountLift: 0 } as EntityView;
}

interface PainterAccess {
  anchorScratch: Array<NameplatePickCandidate>;
  anchorCount: number;
}

function plateIds(painter: NameplatePainter): number[] {
  const access = painter as unknown as PainterAccess;
  return access.anchorScratch
    .slice(0, access.anchorCount)
    .map((anchor) => anchor.id)
    .sort((a, b) => a - b);
}

function harness(targets: Entity[]) {
  const player = entity(VIEWER_ID, { kind: 'player', hostile: false });
  player.pos = { x: 0, y: 0, z: 3 } as Entity['pos'];
  const views = new Map<number, EntityView>();
  const entities = new Map<number, Entity>([[player.id, player]]);
  for (const target of targets) {
    views.set(target.id, view());
    entities.set(target.id, target);
  }
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const world = {
    player,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    layer: document.createElement('div'),
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    nameplateDotScale: () => 0,
    isHostilePlayer: () => false,
  });
  // No injected reader: the painter falls back to the live preference, which is
  // the production path, so the toggle and the paint are proven end to end.
  return { painter };
}

describe('production nameplate painter path', () => {
  beforeEach(() => {
    resetNameplateViewPrefs();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ok');
  });

  it('drops a hidden friendly plate from the pick anchors and keeps the hostile one', () => {
    const wolf = entity(2);
    const npc = entity(3, { hostile: false });
    const { painter } = harness([wolf, npc]);

    painter.update(true);
    expect(plateIds(painter)).toEqual([2, 3]);

    expect(toggleFriendlyNameplates()).toBe(false);
    painter.update(true);
    expect(plateIds(painter)).toEqual([2]);

    // And back: the key is a toggle, not a one-way hide.
    expect(toggleFriendlyNameplates()).toBe(true);
    painter.update(true);
    expect(plateIds(painter)).toEqual([2, 3]);
  });

  it('leaves a lootable corpse plate up with the toggle off', () => {
    const corpse = entity(2, { dead: true, lootable: true, hostile: false });
    const { painter } = harness([corpse]);

    toggleFriendlyNameplates();
    painter.update(true);
    expect(plateIds(painter)).toEqual([2]);
  });
});
