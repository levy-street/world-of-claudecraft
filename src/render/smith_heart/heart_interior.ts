// The Smith's Heart's open-air interior (docs/design/raid/smith_heart.md):
// the authored field's terraces (Stormcrag slate, quarried earth, snow and
// lake ice, the Hearth's columnar basalt, the dais's and the Heart's ritual
// floors) with bedded-strata cliffs, the mountain's rock rising along every
// outer lip (each vein an open fissure, the Cornice a summit, the Heart a
// chamber inside the mountain), the rooms' hero props, each vein's colour
// lights, the floor light-rivers, the heart seal, the portals, the Heart's
// core, chains and keels, the gates, and the sky (the storm over the main
// map, the ember night over the Heart). Built once per claimed slot the
// player approaches, attached through the renderer's compile gate (dungeon.ts
// via open_air_fields.ts), never removed.

import * as THREE from 'three';
import {
  inSmithHeartRoom,
  SMITH_HEART_FIELD,
  SMITH_HEART_FLOATING_SURFACES,
  SMITH_HEART_VEINS,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { buildAuthoredFieldTerrain } from '../authored_field/field_terrain';
import { sharedUniforms } from '../gfx';
import type { FireLightSink } from '../point_light_budget';
import { buildBreathAir } from './breath_air';
import { BREATH_KIT_KINDS, breathKitReady, dressBreath, ensureBreathKit } from './breath_kit';
import { BREATH_KIT_KEEL, BREATH_KIT_SHALLOW } from './breath_kit_plan_core';
import { buildHammerAir } from './hammer_air';
import { dressHammerVein, ensureHammerKit, HAMMER_KIT_KINDS, hammerKitReady } from './hammer_kit';
import { heartCliffPaint } from './heart_cliff_paint_core';
import { inBreathLight, inHeatLight, inQuenchLight } from './heart_environment';
import { heartFinalDarkness } from './heart_final_core';
import { buildHeartGates } from './heart_gates';
import { ensureHeartKit, heartKitProgramWarmers, SMITH_HEART_GATE_KIT_URL } from './heart_kit';
import { buildHeartLights } from './heart_lights';
import { buildHeartMountain } from './heart_mountain';
import { buildHeartPortals } from './heart_portal';
import {
  heartAreaBlend,
  heartHopLanding,
  heartHopStage,
  heartPortalStage,
} from './heart_portal_core';
import { buildHeartProps, buildHeartWalls } from './heart_props';
import { buildHeartRivers } from './heart_rivers';
import { dressHeartMountain, ensureHeartRockKit } from './heart_rock';
import { setHeartRockSlot } from './heart_rock_cutaway';
import { buildHeartRoom } from './heart_room';
import {
  buildHeartRoomKit,
  ensureHeartRoomKit,
  HEART_KIT_KINDS,
  heartRoomKitReady,
} from './heart_room_kit';
import {
  HEART_KIT_KEELS,
  HEART_KIT_OMIT_TOPS,
  HEART_KIT_SHALLOW,
} from './heart_room_kit_plan_core';
import { buildHeartSeal } from './heart_seal';
import { heartSealSlotKey, heartSealView, newHeartSealView } from './heart_seal_core';
import { buildHeartSky } from './heart_sky';
import { buildHeatAir } from './heat_air';
import { hearthFloorMaterial } from './heat_hearth_floor';
import { dressHeat, ensureHeatKit, HEAT_KIT_KINDS, heatKitReady } from './heat_kit';
import { HEAT_KIT_SHALLOW } from './heat_kit_plan_core';
import { buildHeatPour } from './heat_pour';
import { buildQuenchAir } from './quench_air';
import { dressQuench, ensureQuenchKit, QUENCH_KIT_KINDS, quenchKitReady } from './quench_kit';
import { lakeIceMaterial } from './quench_lake_ice';
import {
  dressRing,
  ensureRingKit,
  RING_KIT_KINDS,
  RING_KIT_OMIT_TOPS,
  ringKitReady,
} from './ring_kit';

export interface SmithHeartInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

const ground = (x: number, z: number): number => authoredFieldHeight(SMITH_HEART_FIELD, x, z);

/** A pause longer than this (the interior hidden: the player left the run)
 *  forgets the last camera, so the next frame is never read as a hop. */
const DRIVER_GAP = 0.5;

/** Build the whole Smith's Heart for the slot anchored at (ox, oz),
 *  instance-local. Waits (capped) for the veins' Blender kits first. */
export async function buildSmithHeartInterior(
  deps: SmithHeartInteriorDeps,
  ox: number,
  oz: number,
): Promise<THREE.Group> {
  await Promise.all([
    ensureHammerKit(),
    ensureHeartRockKit(),
    ensureRingKit(),
    ensureBreathKit(),
    ensureQuenchKit(),
    ensureHeatKit(),
    ensureHeartKit(SMITH_HEART_GATE_KIT_URL),
    ensureHeartRoomKit(),
  ]);
  // The Ring kit draws the two stairs tread by tread and the dais's keel
  // (phase 2F); without it the field's own ramps and keel stand.
  const ringReady = ringKitReady();
  // The Breath kit draws the Wind Bridge's arch (phase 2G): the field then
  // keeps only a shallow keel under its deck.
  const breathReady = breathKitReady();
  const quenchReady = quenchKitReady();
  // The Heat kit draws the anvil bridge's arch (phase 2I): the field then
  // keeps only a shallow keel under its deck.
  const heatReady = heatKitReady();
  // The Heart kit draws the platform, the terrace, the bridge and their keels,
  // the altars and the roots (phase 2J); without it the blockout stands.
  const heartReady = heartRoomKitReady();
  const group = new THREE.Group();
  group.name = 'smithHeartField';
  // The rock's regional paint (the Quench's frost) reads this slot from its
  // first frame (the frame driver keeps it current after).
  setHeartRockSlot(ox, oz);
  group.add(
    buildAuthoredFieldTerrain(SMITH_HEART_FIELD, {
      lowGfx: deps.lowGfx,
      cliffRock: 'strata',
      // The Hammer vein's faces in its cool quarry granite (phase 2C).
      cliffPaint: heartCliffPaint,
      // The round islands hang over the void on keels (heart_room.ts).
      shallow: {
        surfaces: new Set([
          ...SMITH_HEART_FLOATING_SURFACES,
          ...(breathReady ? BREATH_KIT_SHALLOW : []),
          ...(heatReady ? HEAT_KIT_SHALLOW : []),
          ...(heartReady ? HEART_KIT_SHALLOW : []),
        ]),
        depth: BREATH_KIT_KEEL,
      },
      ...(ringReady || heartReady
        ? {
            omitTops: new Set([
              ...(ringReady ? RING_KIT_OMIT_TOPS : []),
              ...(heartReady ? HEART_KIT_OMIT_TOPS : []),
            ]),
          }
        : {}),
      // The Frozen Lake and the Singing Ice drawn with the ice's depth
      // (phase 2H).
      // The Heat's floors with the fire in their joints (phase 2I).
      topMaterial: {
        lake_ice: (pair) => lakeIceMaterial(pair, deps.lowGfx),
        hearth: (pair) => hearthFloorMaterial(pair, deps.lowGfx),
      },
    }),
  );
  group.add(buildHeartMountain(deps.lowGfx));
  // The mountain's rock (phase 2E), the loose crags until its kit lands.
  dressHeartMountain(group, () => buildHeartWalls(deps.lowGfx), deps.lowGfx);
  const kitReady = hammerKitReady();
  const kitKinds = new Set([
    ...HAMMER_KIT_KINDS,
    ...RING_KIT_KINDS,
    ...BREATH_KIT_KINDS,
    ...QUENCH_KIT_KINDS,
    ...HEAT_KIT_KINDS,
    ...HEART_KIT_KINDS,
  ]);
  const drawn = new Set([
    ...(kitReady ? HAMMER_KIT_KINDS : []),
    ...(ringReady ? RING_KIT_KINDS : []),
    ...(breathReady ? BREATH_KIT_KINDS : []),
    ...(quenchReady ? QUENCH_KIT_KINDS : []),
    ...(heatReady ? HEAT_KIT_KINDS : []),
    ...(heartReady ? HEART_KIT_KINDS : []),
  ]);
  const props = buildHeartProps(kitKinds, drawn);
  group.add(props.group);
  dressHammerVein(group, props.kitOwned, deps.lowGfx);
  dressRing(group, props.kitOwned, deps.lowGfx);
  dressBreath(group, props.kitOwned, deps.lowGfx);
  dressQuench(group, props.kitOwned, deps.lowGfx);
  dressHeat(group, props.kitOwned, deps.lowGfx);
  // The kit's slot programs link with the interior even when the kit lands
  // late (the swap then links nothing in a live frame).
  group.add(heartKitProgramWarmers());
  group.add(buildHammerAir(deps.lowGfx));
  group.add(buildBreathAir(deps.lowGfx));
  group.add(buildQuenchAir(deps.lowGfx));
  group.add(buildHeatAir(deps.lowGfx));
  group.add(buildHeatPour(deps.lowGfx));
  const heartKit = heartReady ? buildHeartRoomKit(deps.lowGfx) : null;
  if (heartKit) group.add(heartKit.group);
  const room = buildHeartRoom(
    deps.lowGfx,
    new Set([...(ringReady ? ['seal_dais'] : []), ...(heartReady ? HEART_KIT_KEELS : [])]),
    heartReady,
  );
  group.add(room.group);
  buildHeartLights(group, deps, ground);
  const rivers = buildHeartRivers();
  group.add(rivers.group);
  const seal = buildHeartSeal(deps.lowGfx);
  group.add(seal.group);
  const portals = buildHeartPortals(deps.lowGfx, ground);
  group.add(portals.group);
  const gates = buildHeartGates(ox, oz, ground);
  group.add(gates.group);
  const slot = heartSealSlotKey(ox, oz);
  const view = newHeartSealView();
  const stage = heartPortalStage(-1);
  const hop = heartHopStage(-1);
  const local = { x: 0, y: 0, z: 0 };
  let prev: { x: number; z: number } | null = null;
  let lastNow = -1;
  let blend = 0;
  let breathBlend = 0;
  let quenchBlend = 0;
  let heatBlend = 0;
  let hopAt = -1;
  let hopSide: 'heart' | 'ring' | null = null;
  const sky = buildHeartSky({
    lowGfx: deps.lowGfx,
    onFrame: (camera) => {
      const now = sharedUniforms.uTime.value;
      const dt = lastNow < 0 ? 999 : now - lastNow;
      lastNow = now;
      // The rock's regional paint (the Quench's frost) reads this slot.
      setHeartRockSlot(ox, oz);
      local.x = camera.x - ox;
      local.y = camera.y;
      local.z = camera.z - oz;
      if (dt > DRIVER_GAP) prev = null;
      // The hop: the camera crossed from one area to the other in a frame.
      const landed = heartHopLanding(prev, local);
      if (landed) {
        hopAt = now;
        hopSide = landed;
      }
      if (prev) {
        prev.x = local.x;
        prev.z = local.z;
      } else {
        prev = { x: local.x, z: local.z };
      }
      blend = heartAreaBlend(blend, inSmithHeartRoom(local.x, local.z), dt);
      sky.setCore(blend);
      breathBlend = heartAreaBlend(breathBlend, inBreathLight(local.x, local.z), dt);
      sky.setBreath(breathBlend);
      quenchBlend = heartAreaBlend(quenchBlend, inQuenchLight(local.x, local.z), dt);
      sky.setQuench(quenchBlend);
      heatBlend = heartAreaBlend(heatBlend, inHeatLight(local.x, local.z), dt);
      sky.setHeat(heatBlend);
      heartSealView(slot, now, view);
      // The heart going dark when the Masterless Strength falls (phase 2J):
      // the core in its bed, the rune rings, the altars, the roots and the
      // channels with it.
      const dark = heartFinalDarkness(slot, now);
      room.setHeart(1 - dark);
      heartKit?.setHeart(1 - dark);
      for (const v of SMITH_HEART_VEINS) {
        room.setVein(v, 1 - 0.85 * dark);
        heartKit?.setVein(v, 1 - 0.7 * dark);
      }
      heartPortalStage(view.portalSince, stage);
      heartHopStage(hopAt < 0 ? -1 : now - hopAt, hop);
      rivers.update(view);
      seal.update(view, stage, view.portalSince);
      portals.update(stage, hop, hopSide);
      portals.wash(hop.flash, local);
      gates.update();
    },
  });
  group.add(sky.mesh);
  return group;
}
