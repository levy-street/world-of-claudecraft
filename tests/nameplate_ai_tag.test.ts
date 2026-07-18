// @vitest-environment jsdom
//
// The operator-set [AI] account tag on the overhead nameplate. Nameplates are
// positioned DOM divs, so the tag is a class toggle on its own span, not a
// repaint; the trap is the plate's static SIGNATURE. Every static field a plate
// draws has to be in that signature, or `setNameplateStatic` early-outs and the
// plate keeps whatever it last painted. So the decisive test here is a LIVE FLIP:
// paint a normal player, flip aiAccount on the same entity, paint again, and the
// tag must appear. Drop `isAi` from the signature and this goes red.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NameplatePainter } from '../src/render/nameplate_painter';
import { FRIENDLY } from '../src/render/reaction';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };

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
  const div = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  };
  const img = () => document.createElement('img');
  const nameplate = div('nameplate');
  const aiEl = document.createElement('span');
  aiEl.className = 'np-ai';
  const levelEl = document.createElement('span');
  levelEl.className = 'np-level';
  levelEl.style.display = 'none';
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  return {
    group,
    height: 2,
    nameplate,
    nameEl: div('np-name'),
    titleEl: div('np-title'),
    guildEl: div('np-guild'),
    hpBar: div('np-hpbar'),
    hpFill: div('np-hpfill'),
    emoteEl: div('np-emote'),
    emoteIconEl: img(),
    emoteLabelEl: document.createElement('span'),
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
    aiEl,
    levelEl,
    nameplateDisplay: 'none',
    nameplateTransform: '',
    nameplateSig: '',
    nameplateHpWidth: '',
    nameplateScale: 1,
    nameplateBaseOpacity: '1',
    nameplateOpacity: '',
    comboSig: '',
    tierValue: 0,
    devTierValue: 0,
    discordAvatarSig: '',
    levelSig: '',
  } as unknown as EntityView;
}

/** A painter looking straight at a target standing next to the viewer. */
function harness(
  target: Entity,
  options: {
    me?: Partial<Entity>;
    isHostilePlayer?: (e: Entity) => boolean;
  } = {},
) {
  const me = entity({
    id: 1,
    name: 'Me',
    pos: { x: 0, y: 0, z: 3 } as Entity['pos'],
    ...options.me,
  });
  const views = new Map<number, EntityView>();
  const v = view();
  views.set(target.id, v);
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const world = {
    player: me,
    entities: new Map<number, Entity>([
      [me.id, me],
      [target.id, target],
    ]),
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
    isHostilePlayer: options.isHostilePlayer ?? (() => false),
  });
  return { painter, v };
}

describe('nameplate [AI] account tag', () => {
  it('draws no tag for a normal player', () => {
    const target = entity({ id: 2 });
    const { painter, v } = harness(target);
    painter.update(true);

    // the plate really did paint (otherwise the assertions below are vacuous)
    expect(v.nameEl.textContent).toBe('Streamer');
    expect(v.aiEl.classList.contains('ai-tag')).toBe(false);
    expect(v.aiEl.textContent).toBe('');
  });

  it('draws the tag for an AI-flagged account', () => {
    const target = entity({ id: 2, aiAccount: true });
    const { painter, v } = harness(target);
    painter.update(true);

    expect(v.aiEl.classList.contains('ai-tag')).toBe(true);
    expect(v.aiEl.textContent).toBe('[AI]');
  });

  it('repaints on a LIVE flag flip: isAi is part of the plate signature', () => {
    const target = entity({ id: 2 });
    const { painter, v } = harness(target);
    painter.update(true);
    expect(v.aiEl.classList.contains('ai-tag')).toBe(false);

    // An admin flips the flag on a live account. Nothing else about the plate
    // changed, so only isAi being in the signature can force the repaint.
    target.aiAccount = true;
    painter.update(true);
    expect(v.aiEl.classList.contains('ai-tag')).toBe(true);
    expect(v.aiEl.textContent).toBe('[AI]');

    // ...and back off again.
    target.aiAccount = false;
    painter.update(true);
    expect(v.aiEl.classList.contains('ai-tag')).toBe(false);
    expect(v.aiEl.textContent).toBe('');
  });

  it('keeps the tag on its own span so the name keeps its role colour and shadow', () => {
    const target = entity({ id: 2, aiAccount: true, discordRole: 'admin' });
    const { painter, v } = harness(target);
    painter.update(true);

    // The name is never restyled into the gradient: it keeps its own element (and
    // therefore its black text-shadow, which is what keeps it legible over bright
    // terrain), while the tag lives beside it.
    expect(v.nameEl.classList.contains('ai-tag')).toBe(false);
    expect(v.nameEl.textContent).toContain('Streamer');
    expect(v.aiEl).not.toBe(v.nameEl);
    expect(v.aiEl.classList.contains('ai-tag')).toBe(true);
  });
});

describe('nameplate state classes', () => {
  it('toggles combat-state classes for a targeted hostile dead lootable enemy', () => {
    const target = entity({
      id: 2,
      kind: 'mob',
      templateId: 'wolf',
      dead: true,
      lootable: true,
      hostile: true,
      aggroTargetId: 1,
    });
    const { painter, v } = harness(target, { me: { targetId: 2 } });
    painter.update(true);

    expect(v.nameplate.classList.contains('np-current-target')).toBe(true);
    expect(v.nameplate.classList.contains('np-hostile')).toBe(true);
    expect(v.nameplate.classList.contains('np-dead-enemy')).toBe(true);
    expect(v.nameplate.classList.contains('np-aggroed-on-me')).toBe(true);
    expect(v.nameplate.classList.contains('np-my-pet')).toBe(false);
    expect(v.nameplate.classList.contains('np-friendly-pet')).toBe(false);
  });

  it('toggles pet-state classes for your friendly pet', () => {
    const target = entity({
      id: 2,
      kind: 'mob',
      templateId: 'wolf',
      ownerId: 1,
      hostile: false,
    });
    const { painter, v } = harness(target);
    painter.update(true);

    expect(v.nameplate.classList.contains('np-my-pet')).toBe(true);
    expect(v.nameplate.classList.contains('np-friendly-pet')).toBe(true);
    expect(v.nameplate.classList.contains('np-hostile')).toBe(false);
  });
});

describe('nameplate level badge', () => {
  it('shows, hides, and recolors the level badge as mob state changes', () => {
    const target = entity({
      id: 2,
      kind: 'mob',
      templateId: 'wolf',
      level: 13,
      hostile: true,
    });
    const { painter, v } = harness(target);

    painter.update(true);
    expect(v.levelEl.textContent).toBe('13');
    expect(v.levelEl.style.display).toBe('');
    expect(v.levelSig).toBe('13|#ff4444');

    target.dead = true;
    target.lootable = true;
    painter.update(true);
    expect(v.levelEl.style.display).toBe('none');

    target.dead = false;
    target.hostile = false;
    target.ownerId = 1;
    painter.update(true);
    expect(v.levelEl.textContent).toBe('13');
    expect(v.levelEl.style.display).toBe('');
    expect(v.levelSig).toBe(`13|${FRIENDLY}`);
  });
});
