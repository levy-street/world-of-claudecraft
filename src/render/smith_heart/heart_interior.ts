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
  HEART_ROOM,
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
import {
  breathEnvFloorMaterial,
  breathEnvKitReady,
  breathEnvPainting,
  breathEnvProgramWarmers,
  breathEnvSkyTexture,
} from './breath_env_kit';
import { breathRockPaintLayer, composeRockPaints } from './breath_env_rock_paint';
import { BREATH_KIT_KINDS, breathKitReady, dressBreath, ensureBreathKit } from './breath_kit';
import { BREATH_KIT_KEEL, BREATH_KIT_SHALLOW } from './breath_kit_plan_core';
import { CORNICE_SHEER, CORNICE_SURFACE } from './breath_stone_core';
import { buildBreathSummit } from './breath_summit';
import { buildHammerAir } from './hammer_air';
import {
  hammerEnvFloorMaterial,
  hammerEnvKitReady,
  hammerEnvPainting,
  hammerEnvProgramWarmers,
  hammerEnvSkyTexture,
} from './hammer_env_kit';
import { HAMMER_ENV_PAVED, HAMMER_ENV_STAIRS, hammerEnvPathUv } from './hammer_env_plan_core';
import { hammerRockPaintLayer } from './hammer_env_rock_paint';
import { dressHammerVein, ensureHammerKit, HAMMER_KIT_KINDS, hammerKitReady } from './hammer_kit';
import { heartArrivalFlare, heartArrivalVein } from './heart_arrival_light_core';
import { heartCliffPaint } from './heart_cliff_paint_core';
import { heartCollapseDim, heartCollapseHeartLevel } from './heart_collapse_core';
import { buildHeartEnvDress, heartOpenMountainLayer } from './heart_env_dress';
import { inBreathLight, inHammerSky, inHeatLight, inQuenchLight } from './heart_environment';
import { heartFinalDarkness } from './heart_final_core';
import { ensureHeartFourSky, heartFourSkyTexture, heartRingSkyTexture } from './heart_four_sky';
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
import { buildHeartQuarters } from './heart_quarters';
import { buildHeartRivers } from './heart_rivers';
import { dressHeartMountain, ensureHeartRockKit } from './heart_rock';
import {
  setHeartRockBreathPaint,
  setHeartRockCore,
  setHeartRockHammer,
  setHeartRockHammerPaint,
  setHeartRockHeatOpen,
  setHeartRockHeatPaint,
  setHeartRockQuenchPaint,
  setHeartRockSlot,
} from './heart_rock_cutaway';
import { buildHeartRoom } from './heart_room';
import {
  buildHeartRoomKit,
  ensureHeartRoomKit,
  HEART_KIT_KINDS,
  heartRoomKitReady,
} from './heart_room_kit';
import {
  HEART_KIT_KEELS,
  HEART_KIT_NO_SKIRT,
  HEART_KIT_OMIT_TOPS,
  HEART_KIT_SHALLOW,
} from './heart_room_kit_plan_core';
import { buildHeartSeal } from './heart_seal';
import { heartSealSlotKey, heartSealView, newHeartSealView } from './heart_seal_core';
import { buildHeartSky } from './heart_sky';
import { buildHeatAir } from './heat_air';
import {
  heatEnvFloorMaterial,
  heatEnvKitReady,
  heatEnvPainting,
  heatEnvProgramWarmers,
  heatEnvSkyTexture,
} from './heat_env_kit';
import { heatRockPaintLayer } from './heat_env_rock_paint';
import { buildHeatEnvSet } from './heat_env_set';
import { hearthFloorMaterial } from './heat_hearth_floor';
import { dressHeat, ensureHeatKit, HEAT_KIT_KINDS, heatKitReady } from './heat_kit';
import { HEAT_KIT_SHALLOW } from './heat_kit_plan_core';
import { buildHeatPour } from './heat_pour';
import { buildQuenchAir } from './quench_air';
import {
  quenchEnvFloorMaterial,
  quenchEnvKitReady,
  quenchEnvLakePair,
  quenchEnvPainting,
  quenchEnvProgramWarmers,
  quenchEnvSkyTexture,
} from './quench_env_kit';
import { quenchRockPaintLayer } from './quench_env_rock_paint';
import { dressQuench, ensureQuenchKit, QUENCH_KIT_KINDS, quenchKitReady } from './quench_kit';
import { lakeIceMaterial } from './quench_lake_ice';
import {
  dressRing,
  ensureRingKit,
  RING_KIT_KINDS,
  RING_KIT_OMIT_TOPS,
  ringKitReady,
} from './ring_kit';
import { buildRingSet } from './ring_set';

export interface SmithHeartInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: FireLightSink;
}

const ground = (x: number, z: number): number => authoredFieldHeight(SMITH_HEART_FIELD, x, z);

/** A pause longer than this (the interior hidden: the player left the run)
 *  forgets the last camera, so the next frame is never read as a hop. */
const DRIVER_GAP = 0.5;

/** The sky's arrival flare centres this high over the platform (yards):
 *  well up the final boss's beam (smith_heart_fx/final_arrival_core.ts
 *  ARRIVAL_BEAM, far taller), where its light meets the sky in view. */
const HEART_FLARE_Y = 150;

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
    ensureHeartFourSky(),
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
  const hammerEnvReady = hammerEnvKitReady();
  // The Breath's painted rebuild (its kit fetched with the old Breath kit's).
  const breathEnvReady = breathEnvKitReady();
  // The Quench's painted rebuild (its kit fetched with the old Quench kit's).
  const quenchEnvReady = quenchEnvKitReady();
  // The Heat's painted rebuild (its kit fetched with the old Heat kit's).
  const heatEnvReady = heatEnvKitReady();
  // Each painted vein's rock on the heightfield and the field's cliff faces, one clone.
  const rockPaint = composeRockPaints(
    hammerEnvReady ? hammerRockPaintLayer() : null,
    breathEnvReady ? breathRockPaintLayer() : null,
    quenchEnvReady ? quenchRockPaintLayer() : null,
    heatEnvReady ? heatRockPaintLayer() : null,
  );
  setHeartRockHammerPaint(hammerEnvReady ? hammerEnvPainting('cliff') : null);
  setHeartRockBreathPaint(breathEnvReady ? breathEnvPainting('cliff') : null);
  setHeartRockQuenchPaint(quenchEnvReady ? quenchEnvPainting('cliff') : null);
  setHeartRockHeatPaint(heatEnvReady ? heatEnvPainting('cliff') : null);
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
      // The Storm Cornice's open rim falls sheer (Jose's playtest of
      // 2026-11-04: its skirt flared out pale past the red edge, rock that
      // read as ground where a body still falls).
      sheer: { surfaces: new Set([CORNICE_SURFACE]), depth: CORNICE_SHEER },
      // The Anvil's rock is the kit's own, and a quarter of it can really fall.
      ...(heartReady ? { noSkirt: new Set(HEART_KIT_NO_SKIRT) } : {}),
      ...(ringReady || heartReady || hammerEnvReady
        ? {
            omitTops: new Set([
              ...(ringReady ? RING_KIT_OMIT_TOPS : []),
              ...(heartReady ? HEART_KIT_OMIT_TOPS : []),
              ...(hammerEnvReady ? HAMMER_ENV_STAIRS : []),
            ]),
          }
        : {}),
      // The Frozen Lake and the Singing Ice drawn with the ice's depth
      // (phase 2H).
      // The Heat's floors with the fire in their joints (phase 2I).
      topMaterial: {
        // Painted (the lake painting under the ice's depth) once the Quench's painted
        // kit has landed.
        lake_ice: (pair) =>
          lakeIceMaterial(pair, deps.lowGfx, quenchEnvReady ? quenchEnvLakePair() : null),
        // The Heat's painted basalt floors once its painted kit has landed (the molten an
        // accent: the seams of fire, the channel and the route's thread stay the old kit's).
        hearth: heatEnvReady
          ? () => heatEnvFloorMaterial()
          : (pair) => hearthFloorMaterial(pair, deps.lowGfx),
        // The Hammer vein's painted floors, once the painted kit has landed.
        ...(hammerEnvReady
          ? {
              paving: () => hammerEnvFloorMaterial('paving'),
              quarry: () => hammerEnvFloorMaterial('quarry'),
            }
          : {}),
        // The Breath's storm-scoured slabs, once its painted kit has landed.
        ...(breathEnvReady ? { scoured: () => breathEnvFloorMaterial() } : {}),
        // The Quench's frost-bound flagstones, once its painted kit has landed.
        ...(quenchEnvReady ? { rime: () => quenchEnvFloorMaterial() } : {}),
      },
      ...(hammerEnvReady
        ? {
            drawnGround: (id, ground) => (HAMMER_ENV_PAVED.has(id) ? 'paving' : ground),
            drawnUv: hammerEnvPathUv,
          }
        : {}),
      ...(rockPaint ? { cliffMaterial: rockPaint } : {}),
    }),
  );
  // The mountain alone opens round the Heart to the four elements' cliffs, seen from inside
  // it (heart_env_dress.ts): its own clone, never the field cliffs'.
  group.add(
    buildHeartMountain(
      deps.lowGfx,
      composeRockPaints(
        hammerEnvReady ? hammerRockPaintLayer() : null,
        breathEnvReady ? breathRockPaintLayer() : null,
        quenchEnvReady ? quenchRockPaintLayer() : null,
        heatEnvReady ? heatRockPaintLayer() : null,
        heartOpenMountainLayer(),
      ),
    ),
  );
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
  // The painted kit's too, when the vein is built painted: a kit landing late then brings
  // no painting into a live frame that the gate has not prepared.
  if (hammerEnvReady) group.add(hammerEnvProgramWarmers(deps.lowGfx));
  if (breathEnvReady) group.add(breathEnvProgramWarmers());
  if (quenchEnvReady) group.add(quenchEnvProgramWarmers());
  if (heatEnvReady) group.add(heatEnvProgramWarmers());
  group.add(buildHammerAir(deps.lowGfx));
  group.add(buildBreathAir(deps.lowGfx));
  // The Cornice's open sky: the cloud sea under the summit, the far peaks.
  group.add(buildBreathSummit(deps.lowGfx));
  group.add(buildQuenchAir(deps.lowGfx));
  group.add(buildHeatAir(deps.lowGfx));
  // The Heat's set round its hall (its lake, falls, glows and smoke), drawn only from the
  // Heat once its painted kit is in (shown by the frame driver).
  const heatSet = buildHeatEnvSet(deps.lowGfx);
  heatSet.visible = false;
  group.add(heatSet);
  // The Heart's crown dressed with the four veins' painted rock, drawn only from the Heart.
  group.add(buildHeartEnvDress(deps.lowGfx));
  group.add(buildHeatPour(deps.lowGfx));
  const heartKit = heartReady ? buildHeartRoomKit(deps.lowGfx) : null;
  if (heartKit) group.add(heartKit.group);
  // The platform's four quarters round the central ring (phase 2K), the one
  // the final boss stands in awake.
  const quarters = heartKit ? buildHeartQuarters(deps.lowGfx, heartKit.altar, heartKit.root) : null;
  if (quarters) group.add(quarters.group);
  const room = buildHeartRoom(
    deps.lowGfx,
    new Set([...(ringReady ? ['seal_dais'] : []), ...(heartReady ? HEART_KIT_KEELS : [])]),
    heartReady,
  );
  group.add(room.group);
  buildHeartLights(group, deps, ground);
  const rivers = buildHeartRivers();
  // The Ring's set: the pit's mist and each vein's rune on its standing stones.
  const ringSet = buildRingSet(deps.lowGfx);
  group.add(ringSet.group);
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
  const flareDir = { x: 0, y: 1, z: 0 };
  let prev: { x: number; z: number } | null = null;
  let lastNow = -1;
  let blend = 0;
  let breathBlend = 0;
  let quenchBlend = 0;
  let heatBlend = 0;
  let hammerBlend = 0;
  let hopAt = -1;
  let hopSide: 'heart' | 'ring' | null = null;
  const sky = buildHeartSky({
    lowGfx: deps.lowGfx,
    hammerSky: hammerEnvReady ? hammerEnvSkyTexture() : null,
    breathSky: breathEnvReady ? breathEnvSkyTexture() : null,
    quenchSky: quenchEnvReady ? quenchEnvSkyTexture() : null,
    heatSky: heatEnvReady ? heatEnvSkyTexture() : null,
    fourSky: heartFourSkyTexture(),
    ringSky: heartRingSkyTexture(),
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
      setHeartRockCore(blend);
      breathBlend = heartAreaBlend(breathBlend, inBreathLight(local.x, local.z), dt);
      sky.setBreath(breathBlend);
      quenchBlend = heartAreaBlend(quenchBlend, inQuenchLight(local.x, local.z), dt);
      sky.setQuench(quenchBlend);
      heatBlend = heartAreaBlend(heatBlend, inHeatLight(local.x, local.z), dt);
      sky.setHeat(heatBlend);
      // The rock round the Heat's hall opens to its tiers of basalt and its set (the painted
      // kit's, read each frame: it can land after the interior is built).
      const heatOpen = heatEnvKitReady() ? heatBlend : 0;
      setHeartRockHeatOpen(heatOpen);
      heatSet.visible = heatOpen > 0.001;
      hammerBlend = heartAreaBlend(hammerBlend, inHammerSky(local.x, local.z), dt);
      sky.setHammer(hammerBlend);
      setHeartRockHammer(hammerBlend);
      heartSealView(slot, now, view);
      // The heart going dark when the Masterless Strength falls (phase 2J):
      // the core in its bed, the rune rings, the altars, the roots and the
      // channels with it.
      // Mythic's fake death and the collapse dim it too (heart_collapse_core.ts).
      const dark = Math.max(heartFinalDarkness(slot, now), heartCollapseDim(slot));
      const heartLevel = heartCollapseHeartLevel(slot, dark);
      room.setHeart(heartLevel);
      heartKit?.setHeart(heartLevel);
      // The final boss's arrival (heart_arrival_light_core.ts): each altar
      // dim round the dormant statue until its vein's light runs, the sky
      // flaring round the beam.
      for (const v of SMITH_HEART_VEINS) {
        heartKit?.setVein(v, (1 - 0.7 * dark) * heartArrivalVein(slot, v));
      }
      const flare = heartArrivalFlare(slot);
      if (flare > 0) {
        flareDir.x = HEART_ROOM.x - local.x;
        flareDir.y = HEART_ROOM.h + HEART_FLARE_Y - local.y;
        flareDir.z = HEART_ROOM.z - local.z;
        const l = Math.hypot(flareDir.x, flareDir.y, flareDir.z) || 1;
        flareDir.x /= l;
        flareDir.y /= l;
        flareDir.z /= l;
      }
      sky.setFlare(flare, flareDir);
      quarters?.update(slot, now, dt, dark);
      heartPortalStage(view.portalSince, stage);
      heartHopStage(hopAt < 0 ? -1 : now - hopAt, hop);
      rivers.update(view);
      ringSet.update(view);
      seal.update(view, stage, view.portalSince);
      portals.update(stage, hop, hopSide);
      portals.wash(hop.flash, local);
      gates.update();
    },
  });
  group.add(sky.mesh);
  return group;
}
