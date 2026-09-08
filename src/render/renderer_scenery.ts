import type * as THREE from 'three';
import type { Entity } from '../sim/types';
import { zoneBiomeAt } from '../sim/world';
import { duskWarmAmount, nightSkyDesat } from './day_night_core';
import { detailHorizonStarved } from './detail_horizon_core';
import { isOpenAirFogState } from './interior_light_rig';
import { wildGlowAmount } from './night_lighting_core';
import type { Renderer } from './renderer';

type SceneryHost = {
  amberFeatures: Renderer['amberFeatures'];
  birds: Renderer['birds'];
  bladeGrass: Renderer['bladeGrass'];
  bladeGrassBand: Renderer['bladeGrassBand'];
  camera: Renderer['camera'];
  cameraLookAt: Renderer['cameraLookAt'];
  cliffScree: Renderer['cliffScree'];
  dnGlobalNight: Renderer['dnGlobalNight'];
  dnGrade: Renderer['dnGrade'];
  dungeons: Renderer['dungeons'];
  eastbrookTownView: Renderer['eastbrookTownView'];
  emberFeatures: Renderer['emberFeatures'];
  entryDetailHorizon: Renderer['entryDetailHorizon'];
  farTerrainView: Renderer['farTerrainView'];
  farVista: Renderer['farVista'];
  fenFeatures: Renderer['fenFeatures'];
  fenbridgeTownView: Renderer['fenbridgeTownView'];
  fish: Renderer['fish'];
  fogState: Renderer['fogState'];
  foliage: Renderer['foliage'];
  frostSky: Renderer['frostSky'];
  galeFeatures: Renderer['galeFeatures'];
  gardenFeatures: Renderer['gardenFeatures'];
  hauntFeatures: Renderer['hauntFeatures'];
  hollowGates: Renderer['hollowGates'];
  impactSite: Renderer['impactSite'];
  jungleFeatures: Renderer['jungleFeatures'];
  lastRequestedFogFar: Renderer['lastRequestedFogFar'];
  lastRequestedFogNear: Renderer['lastRequestedFogNear'];
  lowGfx: Renderer['lowGfx'];
  markRendererWorldPhase: Renderer['markRendererWorldPhase'];
  motes: Renderer['motes'];
  nightAccents: Renderer['nightAccents'];
  nightFeatures: Renderer['nightFeatures'];
  pendingZonePrepares: Renderer['pendingZonePrepares'];
  propsView: Renderer['propsView'];
  queueVisibleZonePrepares: Renderer['queueVisibleZonePrepares'];
  realmFlora: Renderer['realmFlora'];
  reducedMotion: Renderer['reducedMotion'];
  scene: Renderer['scene'];
  sky: Renderer['sky'];
  skyView: Renderer['skyView'];
  starAmt: Renderer['starAmt'];
  subsystemCullFar: Renderer['subsystemCullFar'];
  sunDir: Renderer['sunDir'];
  terrainView: Renderer['terrainView'];
  time: Renderer['time'];
  updateAmbience: Renderer['updateAmbience'];
  updateCelestialSprites: Renderer['updateCelestialSprites'];
  updateEnvBiome: Renderer['updateEnvBiome'];
  updateGodRays: Renderer['updateGodRays'];
  updateKeyLight: Renderer['updateKeyLight'];
  updateUnderwater: Renderer['updateUnderwater'];
  updateZoneFeatureVisibility: Renderer['updateZoneFeatureVisibility'];
  viewFar: Renderer['viewFar'];
  views: Renderer['views'];
  vistaLive: Renderer['vistaLive'];
  weather: Renderer['weather'];
  zoneIdAt: Renderer['zoneIdAt'];
};

/** The world environment frame; the combat/actor frame remains in Renderer. */
export function updateRendererScenery(
  owner: object,
  p: Entity,
  dt: number,
  projectionPixels: number,
  worldPhaseMs: Renderer['lastFrameStats']['worldPhaseMs'],
  worldStart: number,
): number {
  const host = owner as SceneryHost;
  // Terrain chunks / tree buckets past the detail horizon are dropped
  // before the frustum; camera-ghost props fade against the eye ray. On
  // vista tiers this horizon is the classic envelope, never scene fog (the
  // far mesh and the sprites own everything beyond it).
  const fogFar = host.subsystemCullFar();
  // The foliage handoff keys off distance planes (foliage_impostor_core.ts /
  // foliage_lod.ts); with the vista on, the near plane pairs with the CAPPED
  // far the foliage culls against, never scene fog.
  const fogNear =
    host.vistaLive() && host.fogState === 'outdoor'
      ? Math.min((host.scene.fog as THREE.Fog).near, fogFar * 0.55)
      : (host.scene.fog as THREE.Fog).near;
  host.queueVisibleZonePrepares(Math.max(fogFar, host.lastRequestedFogFar));
  // The player standing in a zone whose background prepare is still running
  // escalates that build to fast pacing: the ground under their feet must
  // not keep crawling in at idle-slot speed (a border walk arrives before
  // the neighbour's idle prepare finishes by design; this is its handoff).
  {
    const standingZoneId = host.zoneIdAt(p.pos.x, p.pos.z);
    if (standingZoneId !== null && host.pendingZonePrepares.has(standingZoneId)) {
      host.terrainView.escalateZone(standingZoneId);
    }
    // ...and so does a NEIGHBOUR's unbuilt ground while it is holding the
    // detail horizon in. Standing-zone-only escalation left the common case
    // unserved: unbuilt ground a couple of hundred yards over a border
    // collapses the horizon the player is looking through and hands the
    // mid-field to the coarse vista mesh, which carries no splat texture and
    // takes no shadows. (The clamp is directional now, so this fires on
    // ground actually in frame rather than on anything within a radius; that
    // makes it rarer, not less worth escalating.) Every prepare in flight is
    // escalated rather than the one owning the binding chunk: the queue is
    // urgency-ordered nearest-first and runs one zone at a time, so that is
    // the same zone in all but a race, at no spatial-query cost. See
    // detail_horizon_core.ts for why this is safe to leave on.
    //
    // Vista arm only, deliberately. The fogged arm hides the same clamp
    // behind its murk wall rather than showing coarse ground through it, so
    // the artifact this trades frame time for does not exist there, and its
    // tiers are the ones least able to afford the trade.
    const vistaOutdoor = host.farVista.enabled && host.fogState === 'outdoor';
    if (vistaOutdoor && detailHorizonStarved(fogFar, host.entryDetailHorizon.demandFar())) {
      for (const zoneId of host.pendingZonePrepares.keys()) {
        host.terrainView.escalateZone(zoneId);
      }
    }
  }
  host.terrainView.update(host.camera.position.x, host.camera.position.z, fogFar);
  host.farTerrainView.update(
    host.camera.position.x,
    host.camera.position.z,
    fogFar,
    host.viewFar(),
    host.fogState === 'outdoor',
  );
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'terrain', worldStart);
  host.updateZoneFeatureVisibility(fogFar);
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'zoneVisibility', worldStart);
  // Shared by every occluder-fade view below: same camera and look-at
  // point, so one read stands in for the six repeated field accesses.
  const camX = host.camera.position.x;
  const camY = host.camera.position.y;
  const camZ = host.camera.position.z;
  const eyeX = host.cameraLookAt.x;
  const eyeY = host.cameraLookAt.y;
  const eyeZ = host.cameraLookAt.z;
  const sceneryFar = host.entryDetailHorizon.sceneryCullFar(fogFar);
  host.propsView.update(camX, camY, camZ, eyeX, eyeY, eyeZ, sceneryFar, dt, host.reducedMotion());
  host.eastbrookTownView.update(
    camX,
    camY,
    camZ,
    eyeX,
    eyeY,
    eyeZ,
    sceneryFar,
    dt,
    host.reducedMotion(),
  );
  host.fenbridgeTownView.update(
    camX,
    camY,
    camZ,
    eyeX,
    eyeY,
    eyeZ,
    sceneryFar,
    dt,
    host.reducedMotion(),
  );
  host.dungeons?.update(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, host.reducedMotion());
  host.hollowGates.update(camX, camY, camZ, eyeX, eyeY, eyeZ, dt, host.reducedMotion());
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'props', worldStart);
  host.foliage.update(
    p.pos.x,
    p.pos.z,
    host.camera.position.x,
    host.camera.position.y,
    host.camera.position.z,
    host.cameraLookAt.x,
    host.cameraLookAt.y,
    host.cameraLookAt.z,
    fogNear,
    sceneryFar,
    host.vistaLive() && host.fogState === 'outdoor'
      ? host.farVista.envelopeFar * 0.9
      : host.lastRequestedFogNear,
    host.vistaLive() && host.fogState === 'outdoor'
      ? host.farVista.envelopeFar
      : host.lastRequestedFogFar,
    projectionPixels,
    dt,
    host.reducedMotion(),
  );
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'foliage', worldStart);
  host.fish.update(p.pos.x, p.pos.z, dt);
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'fish', worldStart);
  host.motes.update(p.pos.x, p.pos.z, dt);
  // The wilderness night layer rides beside the ambient motes: same
  // player-centred streaming contract, but gated on real dark and anchored to
  // world cells for the flora (see night_accents.ts).
  // Same outdoor gate as the mob glow: mushrooms and fireflies belong to the
  // sky's clock, so an instanced interior never grows them.
  host.nightAccents?.update(
    host.fogState === 'outdoor' ? wildGlowAmount(host.dnGlobalNight) : 0,
    host.time,
    dt,
    p.pos.x,
    p.pos.z,
  );
  host.bladeGrass.update(p.pos.x, p.pos.z);
  // fogFar here is subsystemCullFar(): the residency-clamped detail
  // horizon, so band blades never stand past unbuilt ground
  host.bladeGrassBand.update(p.pos.x, p.pos.z, fogFar, host.fogState === 'outdoor');
  host.cliffScree.update(p.pos.x, p.pos.z);
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'ambientScenery', worldStart);
  host.realmFlora?.update(host.time);
  host.emberFeatures?.update(host.time);
  host.frostSky?.update(host.time, host.camera.position.x, host.camera.position.z);
  host.fenFeatures?.update(host.time);
  host.amberFeatures?.update(host.time);
  host.nightFeatures?.update(host.time);
  host.hauntFeatures?.update(host.time);
  host.jungleFeatures?.update(host.time);
  host.gardenFeatures?.update(host.time);
  host.galeFeatures?.update(host.time);
  host.birds.update(p.pos.x, p.pos.z, dt);
  host.impactSite.update(p.pos.x, p.pos.z, dt);
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'zoneFeatures', worldStart);
  host.updateAmbience(p.pos.x, host.camera.position.y, dt);
  host.updateUnderwater(dt);
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'ambience', worldStart);
  // shadow frustum follows the player
  const pv = host.views.get(p.id);
  if (pv) host.updateKeyLight(pv.group.position);
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'shadows', worldStart);
  // sky dome + sun disc ride along with the camera. The battleground is
  // OPEN-AIR: dome, sun, and weather render over the band exactly like the
  // overworld (hiding them left a black void above the ramparts).
  host.sky.position.set(host.camera.position.x, 0, host.camera.position.z);
  host.sky.visible = isOpenAirFogState(host.fogState);
  if (host.sky.visible) {
    host.skyView.setCameraPos(host.camera.position.x, host.camera.position.z, dt);
    if (!host.lowGfx) {
      host.skyView.setDayNight(host.dnGrade.sky);
      host.skyView.setCycle(
        host.sunDir,
        duskWarmAmount(host.sunDir.y),
        nightSkyDesat(host.dnGrade.nightAmt),
      );
      host.skyView.setFog((host.scene.fog as THREE.Fog).color);
      host.skyView.setStars(host.starAmt, host.time);
      host.updateEnvBiome(dt);
    }
  }
  // precipitation only falls outdoors; indoors/underwater pass null to clear.
  // The sampler lets a neighbouring zone's weather fall inside the box while
  // the player stands outside it (weather_field_core.ts).
  // Precipitation is unlit, so it takes the grade explicitly or snow stays
  // pure white at midnight. Same multiply as the fog and the water surface.
  host.weather.setDayNight(host.dnGrade.fog);
  host.weather.update(
    host.camera.position,
    dt,
    host.fogState === 'outdoor' ? zoneBiomeAt(p.pos.x, p.pos.z) : null,
    zoneBiomeAt,
  );
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'sky', worldStart);
  host.updateCelestialSprites();
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'sunSprites', worldStart);
  host.updateGodRays();
  worldStart = host.markRendererWorldPhase(worldPhaseMs, 'godRays', worldStart);

  return worldStart;
}
