// @vitest-environment happy-dom

// The World PvP bounty on a nameplate (src/render/nameplate_tag_fill_core.ts):
// a player whose kill streak earned a bounty (Entity.bounty, the `bty` wire
// bit) wears the WHOLE name tag in blood red: the name, the guild line and the
// deed title. The bit is re-read every pass like `hostile`, so a bounty placed
// or ended between two full passes still repaints on the next frame. The
// painter harness (fake canvas context, painter state access) is
// tests/nameplate_pvp_tag.test.ts's.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import {
  bountyFill,
  NAMEPLATE_BOUNTY_FILL,
  nameplateNameFill,
} from '../src/render/nameplate_tag_fill_core';
import type { EntityView } from '../src/render/renderer';
import { WORLD_PVP_BOUNTY_COLOR } from '../src/sim/pvp/world_pvp_bounty';
import type { Entity } from '../src/sim/types';
import { setLanguage } from '../src/ui/i18n';
import { TextSpriteCache } from '../src/ui/text_sprite_cache';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };
/** In front of the camera, inside nameplate range, outside the urgent range. */
const FAR = { x: 0, y: 0, z: -20 } as Entity['pos'];

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

beforeEach(() => {
  setLanguage('en');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,raid');
});

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'player',
    name: 'Streamer',
    templateId: 'warrior',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: false,
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
    ...over,
  } as unknown as Entity;
}

function view(): EntityView {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  return { group, height: 2, mountLift: 0 } as EntityView;
}

function stateOf(painter: NameplatePainter, id: number): NameplateCanvasState {
  const state = (painter as unknown as { states: Map<number, NameplateCanvasState> }).states.get(
    id,
  );
  if (!state) throw new Error(`Missing nameplate state for ${id}`);
  return state;
}

function harness(targets: Entity[], isHostilePlayer: (e: Entity) => boolean = () => false) {
  const me = entity({ id: 1, name: 'Me', pos: { x: 0, y: 0, z: 3 } as Entity['pos'] });
  const views = new Map<number, EntityView>();
  for (const target of targets) views.set(target.id, view());
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const entities = new Map<number, Entity>([[me.id, me]]);
  for (const target of targets) entities.set(target.id, target);
  const world = {
    player: me,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  const layer = document.createElement('div');
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    layer,
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    nameplateDotScale: () => 0,
    isHostilePlayer,
  });
  return { painter, layer, me };
}

describe('the bounty fills', () => {
  it('is a blood red distinct from the hostile-name red', () => {
    expect(NAMEPLATE_BOUNTY_FILL).toBe('#c41e1e');
    expect(NAMEPLATE_BOUNTY_FILL).not.toBe('#ff5555');
    // The realm announcements wear the same red as the name tag.
    expect(WORLD_PVP_BOUNTY_COLOR).toBe(NAMEPLATE_BOUNTY_FILL);
  });

  it('turns any part of the tag blood red under a bounty and leaves it alone otherwise', () => {
    expect(bountyFill(true, '#c9dcfb')).toBe(NAMEPLATE_BOUNTY_FILL);
    expect(bountyFill(false, '#c9dcfb')).toBe('#c9dcfb');
  });

  it('orders the name fill: corpse grey, then bounty, then hostile, then own colour', () => {
    const base = { deadEnemy: false, bounty: false, hostile: false, nameColor: '#7fb8ff' };
    expect(nameplateNameFill(base)).toBe('#7fb8ff');
    expect(nameplateNameFill({ ...base, hostile: true })).toBe('#ff5555');
    expect(nameplateNameFill({ ...base, hostile: true, bounty: true })).toBe(NAMEPLATE_BOUNTY_FILL);
    expect(nameplateNameFill({ ...base, bounty: true })).toBe(NAMEPLATE_BOUNTY_FILL);
    expect(nameplateNameFill({ ...base, bounty: true, deadEnemy: true })).toBe('#bbb');
  });
});

describe('the bounty on a live plate', () => {
  it('follows the wire bit on the next pass, full or not, both ways', () => {
    const target = entity({ id: 2, name: 'Aleph', pos: FAR });
    const { painter } = harness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.bounty).toBe(false);
    target.bounty = true;
    painter.update(false);
    expect(state.bounty).toBe(true);
    target.bounty = false;
    painter.update(false);
    expect(state.bounty).toBe(false);
  });

  it('never marks a non-player, whatever the field says', () => {
    const mob = entity({ id: 2, kind: 'mob', name: 'Wolf', bounty: true } as Partial<Entity> & {
      id: number;
    });
    const { painter } = harness([mob]);
    painter.update(true);
    expect(stateOf(painter, 2).bounty).toBe(false);
  });

  it('carries the <Bounty> tag, the non-colour cue, and follows the bit on a non-full pass', () => {
    const target = entity({ id: 2, name: 'Aleph', pvpFlag: true, pos: FAR });
    const { painter } = harness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.name).toBe('<PvP> Aleph');
    target.bounty = true;
    painter.update(false);
    expect(state.name).toBe('<Bounty> <PvP> Aleph');
    target.bounty = false;
    painter.update(false);
    expect(state.name).toBe('<PvP> Aleph');
  });

  it('paints the deed title, the pledge line and the selected-target styles blood red', () => {
    const draw = vi.spyOn(TextSpriteCache.prototype, 'draw');
    const fills = new Map<string, string>();
    draw.mockImplementation((_ctx, text, _x, _y, style) => {
      fills.set(text, style.fill);
    });
    const titled = entity({ id: 2, name: 'Aleph', title: 'prog_veteran', bounty: true, pos: FAR });
    const pledged = entity({ id: 3, name: 'Bet', pledgeGuild: 'Vale', bounty: true, pos: FAR });
    const { painter, me } = harness([titled, pledged]);
    me.targetId = 3;
    painter.update(true);
    const a = stateOf(painter, 2);
    const b = stateOf(painter, 3);
    expect(a.title).not.toBe('');
    expect(fills.get(a.title)).toBe(NAMEPLATE_BOUNTY_FILL);
    expect(b.currentTarget).toBe(true);
    expect(b.guildLabel).not.toBe('');
    expect(fills.get(b.guildLabel)).toBe(NAMEPLATE_BOUNTY_FILL);
    expect(fills.get(b.name)).toBe(NAMEPLATE_BOUNTY_FILL);
    draw.mockRestore();
  });

  it('leaves the sanction chip its own colour: a mark that means something else', () => {
    const draw = vi.spyOn(TextSpriteCache.prototype, 'draw');
    const fills = new Map<string, string>();
    draw.mockImplementation((_ctx, text, _x, _y, style) => {
      fills.set(text, style.fill);
    });
    const marked = entity({ id: 2, name: 'Aleph', cheaterMark: true, bounty: true, pos: FAR });
    const { painter } = harness([marked]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.cheaterLabel).not.toBe('');
    expect(fills.get(state.cheaterLabel)).toBeDefined();
    expect(fills.get(state.cheaterLabel)).not.toBe(NAMEPLATE_BOUNTY_FILL);
    draw.mockRestore();
  });

  it('paints the name, the guild line and the title blood red', () => {
    const draw = vi.spyOn(TextSpriteCache.prototype, 'draw');
    const fills = new Map<string, string>();
    draw.mockImplementation((_ctx, text, _x, _y, style) => {
      fills.set(text, style.fill);
    });
    const marked = entity({
      id: 2,
      name: 'Aleph',
      guild: 'Vale',
      bounty: true,
      pos: FAR,
    });
    const { painter } = harness([marked]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(fills.get(state.name)).toBe(NAMEPLATE_BOUNTY_FILL);
    expect(fills.get(state.guildLabel)).toBe(NAMEPLATE_BOUNTY_FILL);

    fills.clear();
    marked.bounty = false;
    painter.update(false);
    expect(fills.get(state.name)).toBe('#7fb8ff');
    expect(fills.get(state.guildLabel)).toBeDefined();
    expect(fills.get(state.guildLabel)).not.toBe(NAMEPLATE_BOUNTY_FILL);
    draw.mockRestore();
  });
});
