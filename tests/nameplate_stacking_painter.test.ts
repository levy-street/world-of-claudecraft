// @vitest-environment jsdom
//
// The painter half of the vertical stacking pass: the pure core decides the
// geometry, but only the painter knows which anchor is the current target and
// how tall each plate renders, and it writes those into a POOLED anchor slot
// reused every frame. Nothing in the core's own tests would catch `pinned` wired
// to the wrong entity, a `height` dropped on the pooled path (the path every
// frame after the first takes), or a row flag read off the wrong plan field, so
// this drives the real NameplatePainter and reads the transforms back out.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'mob',
    name: 'Forest Wolf',
    templateId: 'forest_wolf',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 5,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: true,
    ownerId: null,
    guild: '',
    title: null,
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
  const div = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  };
  const img = () => document.createElement('img');
  const span = (cls: string) => {
    const el = document.createElement('span');
    el.className = cls;
    return el;
  };
  const group = new THREE.Group();
  return {
    group,
    height: 2,
    nameplate: div('nameplate'),
    nameEl: div('np-name'),
    titleEl: div('np-title'),
    guildEl: div('np-guild'),
    hpBar: div('np-hpbar'),
    hpFill: div('np-hpfill'),
    emoteEl: div('np-emote'),
    emoteIconEl: img(),
    emoteLabelEl: span('np-emote-label'),
    markerEl: div('np-marker'),
    castBar: div('np-castbar'),
    castFill: div('np-castfill'),
    castLabel: div('np-castlabel'),
    raidMarkEl: div('np-raidmark'),
    comboRow: div('np-combo'),
    comboPips: [div('pip'), div('pip'), div('pip'), div('pip'), div('pip')],
    tierEl: img(),
    devTierEl: img(),
    discordEl: img(),
    aiEl: span('np-ai'),
    levelEl: span('np-level'),
    nameplateDisplay: 'none',
    nameplateTransform: '',
    nameplateSig: '',
    nameplateStateMask: 0,
    nameplateFriendlyPet: false,
    nameplateHpWidth: '',
    nameplateScale: 1,
    nameplateBaseOpacity: '1',
    nameplateOpacity: '',
    comboSig: '',
    tierValue: 0,
    devTierValue: 0,
    discordAvatarSig: '',
    levelSig: '',
    titleSig: '',
  } as unknown as EntityView;
}

/** Screen y the painter wrote into a plate's transform (plates are bottom-anchored). */
function plateY(v: EntityView): number {
  const m = /translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(v.nameplate.style.transform);
  expect(m, `no transform on plate: "${v.nameplate.style.transform}"`).not.toBeNull();
  return Number(m?.[1]);
}

/**
 * Two entities standing at the same spot in front of the viewer, so their plates
 * project onto each other and the stacking pass has to separate them.
 */
function harness(targets: Entity[], me: Partial<Entity> = {}) {
  const viewer = entity({
    id: 1,
    kind: 'player',
    name: 'Me',
    hostile: false,
    pos: { x: 0, y: 0, z: 8 } as Entity['pos'],
    ...me,
  });
  const views = new Map<number, EntityView>();
  const entities = new Map<number, Entity>([[viewer.id, viewer]]);
  for (const t of targets) {
    const v = view();
    v.group.position.set(t.pos.x, t.pos.y, t.pos.z);
    views.set(t.id, v);
    entities.set(t.id, t);
  }
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 14);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const world = {
    player: viewer,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    getViewport: () => VIEWPORT,
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    isHostilePlayer: () => false,
  });
  return { painter, views, viewer };
}

describe('nameplate stacking: painter wiring', () => {
  it('separates two plates that project onto the same spot', () => {
    const a = entity({ id: 2 });
    const b = entity({ id: 3, pos: { x: 0.05, y: 0, z: 0.05 } as Entity['pos'] });
    const { painter, views } = harness([a, b]);

    painter.update(true);

    const ya = plateY(views.get(2) as EntityView);
    const yb = plateY(views.get(3) as EntityView);
    // a full plate height apart, not stacked on top of each other
    expect(Math.abs(ya - yb)).toBeGreaterThan(30);
  });

  it('pins the CURRENT TARGET, not the viewer and not the lower id', () => {
    const a = entity({ id: 2 });
    const b = entity({ id: 3, pos: { x: 0.05, y: 0, z: 0.05 } as Entity['pos'] });
    const solo = harness([a]);
    solo.painter.update(true);
    const unstackedY = plateY(solo.views.get(2) as EntityView);

    // with id 3 targeted, IT keeps the projected spot and id 2 is lifted
    const { painter, views } = harness([a, b], { targetId: 3 });
    painter.update(true);
    const yTargeted = plateY(views.get(3) as EntityView);
    const yOther = plateY(views.get(2) as EntityView);

    expect(Math.abs(yTargeted - unstackedY)).toBeLessThan(1);
    expect(yOther).toBeLessThan(yTargeted - 30); // lifted above it (screen y grows down)
  });

  it("spaces the plate above by the LOWER plate's real height, guild tag and all", () => {
    // the plate that keeps its spot is the one whose height buys the room, so the
    // dressed player is the bottom plate (lower id wins the tie) and the bare mob
    // rides above it
    const above = { id: 3, pos: { x: 0.05, y: 0, z: 0.05 } as Entity['pos'] };
    const bare = harness([entity({ id: 2 }), entity(above)]);
    bare.painter.update(true);
    const bareGap = Math.abs(
      plateY(bare.views.get(2) as EntityView) - plateY(bare.views.get(3) as EntityView),
    );

    const dressed = entity({
      id: 2,
      kind: 'player',
      name: 'Streamer',
      hostile: false,
      guild: 'Ravens',
      title: 'first_blood',
      castingAbility: 'fireball',
      castTotal: 2,
      castRemaining: 1,
    });
    const tall = harness([dressed, entity(above)]);
    tall.painter.update(true);
    const tallGap = Math.abs(
      plateY(tall.views.get(2) as EntityView) - plateY(tall.views.get(3) as EntityView),
    );

    // the guild tag, deed title and cast bar all have to buy vertical room
    expect(tallGap).toBeGreaterThan(bareGap);
  });

  it('keeps the height and pin on the POOLED anchor path (every frame after the first)', () => {
    const mob = entity({ id: 2 });
    const dressed = entity({
      id: 3,
      kind: 'player',
      name: 'Streamer',
      hostile: false,
      guild: 'Ravens',
      title: 'first_blood',
      pos: { x: 0.05, y: 0, z: 0.05 } as Entity['pos'],
    });
    const { painter, views } = harness([mob, dressed], { targetId: 3 });

    painter.update(true);
    const firstGap = Math.abs(
      plateY(views.get(2) as EntityView) - plateY(views.get(3) as EntityView),
    );
    const firstTargetY = plateY(views.get(3) as EntityView);

    // second pass reuses the pooled anchor slots: a dropped height or pinned
    // write shows up here and only here
    painter.update(true);
    expect(Math.abs(plateY(views.get(2) as EntityView) - plateY(views.get(3) as EntityView))).toBe(
      firstGap,
    );
    expect(plateY(views.get(3) as EntityView)).toBe(firstTargetY);
  });

  it('fans a column into the room left above it instead of piling at the screen edge', () => {
    // eight plates whose anchors sit high on screen: the band above them is far
    // smaller than MAX_STACK_LIFT_PX, so the step has to compress to fit
    const targets: Entity[] = [];
    for (let i = 0; i < 8; i++) {
      targets.push(entity({ id: i + 2, pos: { x: i * 0.01, y: 0, z: i * 0.01 } as Entity['pos'] }));
    }
    const { painter, views } = harness(targets);

    painter.update(true);

    const ys = [...views.values()].map(plateY).sort((a, b) => b - a);
    for (let i = 1; i < ys.length; i++) {
      // no two plates share a row, however little room the column has
      expect(ys[i - 1] - ys[i], `rows ${i - 1}/${i} of ${ys.join(',')}`).toBeGreaterThan(0);
    }
  });

  it('never lifts a plate off the top of the viewport', () => {
    // a crowd all projecting to the same spot: the column runs out of screen
    const targets: Entity[] = [];
    for (let i = 0; i < 40; i++) {
      targets.push(entity({ id: i + 2, pos: { x: i * 0.01, y: 0, z: i * 0.01 } as Entity['pos'] }));
    }
    const { painter, views } = harness(targets);

    painter.update(true);

    for (const [id, v] of views) {
      expect(plateY(v), `plate ${id} left the viewport`).toBeGreaterThan(0);
      expect(plateY(v)).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });
});
