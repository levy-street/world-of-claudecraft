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
import {
  LAST_BELL_CAMPAIGN_NPCS,
  LAST_BELL_CAMPAIGN_QUESTS,
} from '../src/sim/content/last_bell_campaign';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { PROPS } from '../src/sim/data';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { answerSceneChoice } from '../src/sim/scenes/choices';
import { sceneById } from '../src/sim/scenes/registry';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { FARSHORE_BREACH, groundHeight } from '../src/sim/world';
import { lastBellStrings } from '../src/ui/i18n.catalog/last_bell';

const KEEPER_FACING_EPSILON_RADIANS = 1e-6;

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
    // The boarding anchors are DERIVED from the measured ship plan (a hair
    // inboard of the generated mating edge), so the world spots are pinned
    // within a float hair rather than as exact literals.
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining([
        { x: expect.closeTo(237.15, 5), z: expect.closeTo(-48.25, 5) },
        { x: expect.closeTo(716.35, 5), z: expect.closeTo(116.25, 5) },
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

  it.each([
    ['mainland', 'ferryman_ewald', MAINLAND_HARBOR],
    ['Gullhaven', 'ferryman_ewald_gullhaven', GULLHAVEN_HARBOR],
  ] as const)(
    'Ewald at the %s post faces the gangway boarding entry',
    (_post, templateId, harbor) => {
      const sim = makeSim();
      const keeper = fixtures(sim, templateId)[0];
      expect(keeper).toBeDefined();
      if (!keeper) return;

      const expectedYaw = Math.atan2(
        harbor.gangplank.x - keeper.pos.x,
        harbor.gangplank.z - keeper.pos.z,
      );
      const yawError = Math.atan2(
        Math.sin(keeper.facing - expectedYaw),
        Math.cos(keeper.facing - expectedYaw),
      );
      expect(Math.abs(yawError)).toBeLessThan(KEEPER_FACING_EPSILON_RADIANS);
    },
  );

  it('presents one Ewald identity at both posts and preserves the canonical Q0 giver', () => {
    const mainland = LAST_BELL_CAMPAIGN_NPCS.ferryman_ewald;
    const gullhaven = LAST_BELL_CAMPAIGN_NPCS.ferryman_ewald_gullhaven;

    expect({
      name: gullhaven.name,
      title: gullhaven.title,
      color: gullhaven.color,
      greeting: gullhaven.greeting,
    }).toEqual({
      name: mainland.name,
      title: mainland.title,
      color: mainland.color,
      greeting: mainland.greeting,
    });
    expect(mainland.questIds).toContain('q_lb_q0_ashore');
    expect(gullhaven.questIds).not.toContain('q_lb_q0_ashore');
    expect(LAST_BELL_CAMPAIGN_QUESTS.q_lb_q0_ashore.giverNpcId).toBe('ferryman_ewald');
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
    teleport(sim, GULLHAVEN_HARBOR.boarding.x, GULLHAVEN_HARBOR.boarding.z);
    const islandEwald = [...sim.entities.values()].find(
      (e) => e.templateId === 'ferryman_ewald_gullhaven',
    );
    expect(islandEwald).toBeTruthy();
    if (!islandEwald) return;
    sim.player.targetId = islandEwald.id;
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

  // Warden Hale's memorial: one authored asset on the berm crest north of the
  // redoubt, replacing the two reused nature-kit blocks that used to stand in
  // for it down in the market. The pin still ties the same three things
  // together (the placement, the Q0 look-at, and the camera-ghost collider),
  // because that is what keeps the shot aimed at the prop it names.
  it('places Warden Hale memorial at the Q0 look-at point with its plinth', () => {
    const statue = {
      key: 'wardenHaleStatue',
      x: 805,
      z: 139,
      rot: Math.PI,
      scale: 1,
      r: 1.26,
      h: 4.8,
    };
    expect(FARSHORE_PROPS.decorProps).toContainEqual(statue);
    expect(PROPS.decorProps).toContainEqual(statue);

    expect(
      PROP_ASSET_DEFS[statue.key],
      `${statue.key} must resolve through the prop registry`,
    ).toBeDefined();
    // One authored mesh, so the retired stand-in parts are gone from it.
    expect('parts' in statue).toBe(false);

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
    expect(group.position.toArray()).toEqual([statue.x, renderBaseY, statue.z]);
    expect(group.rotation.y).toBeCloseTo(Math.PI);
    expect(added.every(({ parent }) => parent === group)).toBe(true);
    expect(
      added.map(({ key, options }) => ({ key, y: options.y ?? 0, scale: options.scale })),
    ).toEqual([{ key: 'wardenHaleStatue', y: 0, scale: 1 }]);
    expect(propPlacementInternalsForTest.decorPropCameraTopY(statue, renderBaseY)).toBeCloseTo(
      groundY + statue.h,
    );

    const scene = sceneById('scn_lb_q0_voyage');
    if (!scene) throw new Error('Q0 voyage scene is not registered');
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
      .find(
        (collider) =>
          collider.type === 'circle' && collider.x === statue.x && collider.z === statue.z,
      );
    expect(statueCollider).toMatchObject({
      type: 'circle',
      x: statue.x,
      z: statue.z,
      // the measured circumscribed footprint, so collision matches the silhouette
      r: 1.26,
    });
    expect(statueCollider?.cameraTopY).toBeCloseTo(
      groundHeight(statue.x, statue.z, seed) + statue.h,
    );

    expect(LAST_BELL_CAMPAIGN_QUESTS.q_lb_q0_ashore.text).toContain(
      'east past the harbor steps and the old statue',
    );
    expect(lastBellStrings.q0.scene.plinth).toContain('bronze warden');
    expect(lastBellStrings.q0.scene.plinth).toContain('plinth');
  });
});
