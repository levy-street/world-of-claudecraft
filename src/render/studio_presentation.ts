import type { Group, Mesh } from 'three';
import type { AbilityVfx } from './ability_vfx';

interface Clearable {
  clear(): void;
}
interface StudioPresentationOwner {
  views: Map<number, unknown>;
  removeView(id: number, terminal?: boolean): void;
  abilityVfx: AbilityVfx;
  abilityVfxFx: Clearable;
  vfx: Clearable;
  needleOfFateVfx: Clearable;
  sentenceVfx: Clearable;
  frozenOrbFx: Clearable;
  mageGroundFx: Clearable;
  warlockMeteorFx: Clearable;
  necromancyGroundFx: Clearable;
  necromancyArmyPortalFx: Clearable;
  abyssalRiftFx: Clearable;
  ringOfFrostVisuals: Clearable;
  hunterTrapVisuals: Clearable;
  glacialFrontVisual: Clearable;
  lightPulses: Clearable;
  cameraImpact: Clearable;
  drainChannelStopLatch: Clearable;
  paladinConsecrationVisuals: { dispose(): void };
  temporalHourglassGroundVisuals: { sync(states: never[]): void };
  riftDeathZoneVisuals: { sync(states: never[]): void };
  waterJetVisualChannels: Map<number, number>;
  snapshotDrainVisualChannels: Set<number>;
  snapshotDemonicDrainVisualChannels: Set<number>;
  healGlowAt: Map<number, number>;
  selfRender: { ready: boolean };
  lastLocalPos: unknown;
  selfFacingOverride: number | null;
  selfFacingLastTarget: number | null;
  selectionRing: Group;
  aoeRings: { ring: Mesh; elapsed: number }[];
}

/** Retire one preview take, preserving world assets, programs and pooled FX.
 * Terminal view removal prevents an unresolved old compile from changing a
 * pooled character that a new take has already acquired. */
export function resetStudioPresentation(owner: object): void {
  const r = owner as StudioPresentationOwner;
  for (const id of [...r.views.keys()]) r.removeView(id, true);
  r.abilityVfx.resetPresentation();
  for (const fx of [
    r.abilityVfxFx,
    r.vfx,
    r.needleOfFateVfx,
    r.sentenceVfx,
    r.frozenOrbFx,
    r.mageGroundFx,
    r.warlockMeteorFx,
    r.necromancyGroundFx,
    r.necromancyArmyPortalFx,
    r.abyssalRiftFx,
    r.ringOfFrostVisuals,
    r.hunterTrapVisuals,
    r.glacialFrontVisual,
    r.lightPulses,
    r.cameraImpact,
    r.drainChannelStopLatch,
  ])
    fx.clear();
  r.paladinConsecrationVisuals.dispose();
  r.temporalHourglassGroundVisuals.sync([]);
  r.riftDeathZoneVisuals.sync([]);
  r.waterJetVisualChannels.clear();
  r.snapshotDrainVisualChannels.clear();
  r.snapshotDemonicDrainVisualChannels.clear();
  r.healGlowAt.clear();
  r.selfRender.ready = false;
  r.lastLocalPos = null;
  r.selfFacingOverride = null;
  r.selfFacingLastTarget = null;
  r.selectionRing.visible = false;
  for (const slot of r.aoeRings) {
    slot.elapsed = Number.POSITIVE_INFINITY;
    slot.ring.visible = false;
  }
}
