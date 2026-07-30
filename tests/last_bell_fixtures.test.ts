// The Last Bell world fixtures through the real Sim: the two ferry boarding
// points (at the harbors' gangplanks), the Tidemill scenario door, and the
// Breach maw spawn as ground objects with their pinned templateIds and
// positions; the breach is pure scenery (interact must ignore it) while the
// ferries stay interactable. Also pins the H1 tear-out: the interim landing
// docks are gone (the authored harbors replaced them, see
// tests/last_bell_harbor.test.ts) while the fishing jetties survive.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PROP_ASSET_DEFS, propPlacementInternalsForTest } from '../src/render/props';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { FARSHORE_PROPS } from '../src/sim/content/farshore';
import { LAST_BELL_CAMPAIGN_QUESTS } from '../src/sim/content/last_bell_campaign';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { PROPS } from '../src/sim/data';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { answerSceneChoice } from '../src/sim/scenes/choices';
import { sceneById } from '../src/sim/scenes/registry';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { FARSHORE_BREACH, groundHeight } from '../src/sim/world';
import { lastBellStrings } from '../src/ui/i18n.catalog/last_bell';

function makeSim(): Sim {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Ash', devCommands: true });
  sim.player.level = 6;
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.rebucket(sim.player);
}

function fixtures(sim: Sim, templateId: string): Entity[] {
  return [...sim.entities.values()].filter((e) => e.templateId === templateId);
}

describe('Last Bell campaign fixtures', () => {
  it('spawns the ferries, the Tidemill door, and the Breach at their pinned spots', () => {
    const sim = makeSim();

    const ferries = fixtures(sim, 'lb_ferry');
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining([
        { x: 239, z: -48 },
        { x: 727.5, z: 130 },
      ]),
    );
    expect(ferries).toHaveLength(2);
    // The fixtures stand at the harbors' gangplanks: the layout is the single
    // source for the boarding anchors, so pin the identity, not a copy.
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining([
        { x: MAINLAND_HARBOR.boarding.x, z: MAINLAND_HARBOR.boarding.z },
        { x: GULLHAVEN_HARBOR.boarding.x, z: GULLHAVEN_HARBOR.boarding.z },
      ]),
    );
    for (const ferry of ferries) {
      expect(ferry.name).toBe('The Farshore Ferry');
      // Scenery: the fare lives on the gangplank keepers' gossip button, so
      // the mooring marker itself is never interactable.
      expect(ferry.lootable).toBe(false);
    }

    const doors = fixtures(sim, 'lb_scenario_door');
    expect(doors).toHaveLength(1);
    expect(doors[0].name).toBe('The Tidemill');
    expect({ x: doors[0].pos.x, z: doors[0].pos.z }).toEqual({ x: 930, z: 12 });
    expect(doors[0].lootable).toBe(true);

    const breaches = fixtures(sim, 'lb_breach_maw');
    expect(breaches).toHaveLength(1);
    expect(breaches[0].name).toBe('The Breach');
    expect({ x: breaches[0].pos.x, z: breaches[0].pos.z }).toEqual({
      x: FARSHORE_BREACH.x,
      z: FARSHORE_BREACH.z,
    });
    // Pin the anchor itself so the fixture cannot silently drift off the crater.
    expect(FARSHORE_BREACH).toEqual({ x: 1012, z: -172 });
  });

  it('ignores interact on the Breach: it is scenery, not a device', () => {
    const sim = makeSim();
    const breach = fixtures(sim, 'lb_breach_maw')[0];
    expect(breach.lootable).toBe(false);

    teleport(sim, breach.pos.x + 1.5, breach.pos.z + 1.5);
    const before = { ...sim.player.pos };

    // Targeted interact: the lootable=false gate must reject it before any
    // lb_ dispatch (and tryLastBellInteract has no lb_breach_maw arm anyway).
    sim.player.targetId = breach.id;
    sim.interact();
    // Untargeted interact right next to it: the proximity scan must skip it too.
    sim.player.targetId = null;
    sim.interact();
    for (let i = 0; i < 5; i++) sim.tick();

    // Nothing happened: no travel, no quest, no scenario, and the breach is
    // untouched (not picked up, not flagged for respawn).
    expect(sim.player.pos).toEqual(before);
    expect(sim.questLog.has('q_lb_q0_ashore')).toBe(false);
    expect(sim.ctx.scenarioRuns.size).toBe(0);
    expect(sim.entities.get(breach.id)).toBe(breach);
    expect(breach.lootable).toBe(false);
    expect(breach.dead).toBe(false);
  });

  it('the keepers sell passage: talk, pay, cross (the moorings stay scenery)', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;
    meta.copper = 25;
    // The mooring marker itself ignores interact, exactly like the breach.
    const mainlandFerry = fixtures(sim, 'lb_ferry').find(
      (f) => f.pos.x === MAINLAND_HARBOR.boarding.x,
    );
    expect(mainlandFerry).toBeTruthy();
    if (!mainlandFerry) return;
    teleport(sim, 238, -47.5);
    sim.player.targetId = mainlandFerry.id;
    sim.interact();
    expect(sim.ctx.activeChoices.size).toBe(0);
    expect(sim.player.pos.x).toBeGreaterThan(200);

    // Talking to Ewald opens the fare; paying crosses.
    const ewald = [...sim.entities.values()].find((e) => e.templateId === 'ferryman_ewald');
    expect(ewald).toBeTruthy();
    if (!ewald) return;
    sim.player.targetId = ewald.id;
    sim.interact();
    expect(answerSceneChoice(sim.ctx, 'ch_lb_ferry_fare_out', 'pay')).toBe(true);
    expect(meta.copper).toBe(15);
    expect(
      Math.hypot(
        sim.player.pos.x - GULLHAVEN_HARBOR.deckArrival.x,
        sim.player.pos.z - GULLHAVEN_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);

    // The cinematic begins on the destination ship and walks the rider down
    // the gangplank. Step back aboard to take the return fare immediately.
    teleport(sim, 727, 131);
    const odda = [...sim.entities.values()].find((e) => e.templateId === 'ferrykeeper_odda');
    expect(odda).toBeTruthy();
    if (!odda) return;
    sim.player.targetId = odda.id;
    sim.interact();
    expect(answerSceneChoice(sim.ctx, 'ch_lb_ferry_fare_back', 'pay')).toBe(true);
    expect(meta.copper).toBe(5);
    expect(
      Math.hypot(
        sim.player.pos.x - MAINLAND_HARBOR.deckArrival.x,
        sim.player.pos.z - MAINLAND_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);
  });

  it('tore out the interim landing docks and kept the fishing jetties', () => {
    // H1 replaced the plank-kit landings with the authored harbors: the two
    // colinear mainland sections at (172 / 177.3, -48) and Gullhaven's town
    // pier dock at (781, 122) are gone.
    expect(ZONE1_PROPS.docks.filter((d) => d.z === -48)).toHaveLength(0);
    expect(FARSHORE_PROPS.docks.filter((d) => d.x === 781 && d.z === 122)).toHaveLength(0);
    // The fishing flavor stays: Demi's vale jetty and the Landing's jetty.
    expect(ZONE1_PROPS.docks.some((d) => d.x === -64 && d.z === 60)).toBe(true);
    expect(FARSHORE_PROPS.docks.some((d) => d.x === 778 && d.z === -36)).toBe(true);
  });

  it('places the old warden statue at the Q0 look-at point with its plinth', () => {
    const statue = {
      key: 'statueBlock',
      x: 818,
      z: 120,
      rot: Math.PI / 2,
      scale: 5,
      r: 1,
      h: 4.4,
      parts: [{ key: 'statueHead', y: 1.95, scale: 2.5 }],
    };
    expect(FARSHORE_PROPS.decorProps).toContainEqual(statue);
    expect(PROPS.decorProps).toContainEqual(statue);

    for (const key of [statue.key, ...statue.parts.map((part) => part.key)]) {
      expect(PROP_ASSET_DEFS[key], `${key} must resolve through the prop registry`).toBeDefined();
    }

    const seed = 4242;
    const groundY = groundHeight(statue.x, statue.z, seed);
    const renderBaseY = groundY - 0.05;
    const group = new THREE.Group();
    const added: {
      parent: THREE.Object3D;
      key: string;
      options: { x?: number; y?: number; z?: number; rot?: number; scale: number };
    }[] = [];
    propPlacementInternalsForTest.placeDecorPropGroup(
      group,
      statue,
      renderBaseY,
      (parent, key, options) => {
        added.push({ parent, key, options });
      },
    );
    expect(group.position.toArray()).toEqual([818, renderBaseY, 120]);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(added.every(({ parent }) => parent === group)).toBe(true);
    expect(
      added.map(({ key, options }) => ({ key, y: options.y ?? 0, scale: options.scale })),
    ).toEqual([
      { key: 'statueBlock', y: 0, scale: 5 },
      { key: 'statueHead', y: 1.95, scale: 2.5 },
    ]);
    expect(propPlacementInternalsForTest.decorPropCameraTopY(statue, renderBaseY)).toBeCloseTo(
      groundY + 4.4,
    );

    const scene = sceneById('scn_lb_q0_ashore');
    if (!scene) throw new Error('Q0 arrival scene is not registered');
    const plinthIndex = scene.ops.findIndex(
      (op) => op.kind === 'line' && op.key === 'lb.q0.scene.plinth',
    );
    const shotOp = scene.ops
      .slice(0, plinthIndex)
      .reverse()
      .find((op) => op.kind === 'camera');
    if (
      shotOp?.kind !== 'camera' ||
      shotOp.shot.kind !== 'dolly' ||
      shotOp.shot.lookAt.kind !== 'point'
    ) {
      throw new Error('Q0 plinth line has no preceding point-target dolly shot');
    }
    expect({
      x: shotOp.shot.lookAt.point.x,
      z: shotOp.shot.lookAt.point.z,
    }).toEqual({ x: statue.x, z: statue.z });
    expect(shotOp.shot.subjectRef).toBe(statue.key);

    const statueCollider = colliderInternalsForTest
      .staticWorldColliders(seed)
      .find((collider) => collider.type === 'circle' && collider.x === 818 && collider.z === 120);
    expect(statueCollider).toMatchObject({
      type: 'circle',
      x: 818,
      z: 120,
      r: 1,
      camGhost: true,
    });
    expect(statueCollider?.cameraTopY).toBeCloseTo(groundHeight(818, 120, seed) + 4.4);

    expect(LAST_BELL_CAMPAIGN_QUESTS.q_lb_q0_ashore.text).toContain(
      'east past the harbor steps and the old statue',
    );
    expect(lastBellStrings.q0.scene.plinth).toContain('bronze warden');
    expect(lastBellStrings.q0.scene.plinth).toContain('plinth');
  });
});
