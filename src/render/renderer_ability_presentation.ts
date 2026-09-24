import type * as THREE from 'three';
import { ABILITIES, ITEMS } from '../sim/data';
import type { IWorld } from '../world_api';
import { AbilityVfx, AbilityVfxFx } from './ability_vfx';
import { resumeActiveAbilityKit } from './ability_vfx/active_kit_prewarm';
import type { AbilityVfxDeps } from './ability_vfx/painter';
import { isLivingWarriorAttentionSource } from './ability_vfx/warrior_attention_core';
import { preparedAbilityAudio, type SpatialAudioSink } from './audio_sink';
import type { CharacterVisual } from './characters/visual';
import { createOnrushArrivalHandler } from './characters/warrior_rush_pose';
import { impactContact } from './impact_contact';
import type { LightPulses } from './light_pulses';
import type { EntityView } from './renderer';
import type { Vfx } from './vfx';
import type { VfxAnchorResolver } from './vfx_anchor';
import { sampleWarriorPowerBone } from './warrior_power_anchor';
import { sampleHandAnchor, weaponTrailAnchor } from './weapon_trail_anchor';

interface PresentationHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  vfx: Vfx;
  anchor: VfxAnchorResolver;
  world(): IWorld;
  time(): number;
  views: Map<number, EntityView>;
  visual(view: EntityView): CharacterVisual | null;
  textureReady(texture: THREE.Texture): boolean;
  ground(x: number, z: number): number;
  height(): number;
  pixelRatio(): number;
  reducedMotion(): boolean;
  audio(): SpatialAudioSink | null;
  spiritBuild: Parameters<AbilityVfxFx['setSpiritBuildScheduler']>[0];
  compile: Parameters<AbilityVfxFx['setSpiritCompileGate']>[0];
  light: LightPulses;
  painter: Pick<
    AbilityVfxDeps,
    | 'castVfxAdmit'
    | 'castVfxReady'
    | 'spawnAoeRing'
    | 'triggerAttack'
    | 'lightPulse'
    | 'addShake'
    | 'screenFlash'
    | 'screenImpact'
  >;
}

/** Existing painter wiring and Warrior equipment/contact reads share one owner.
 * World lookup stays live across world replacement; simulation is never mutated. */
export function createRendererAbilityPresentation(h: PresentationHost) {
  const visual = (id: number) => {
    const view = h.views.get(id);
    return view ? h.visual(view) : null;
  };
  const fx = new AbilityVfxFx(
    h.scene,
    h.camera,
    h.anchor,
    h.ground,
    (id) => h.views.get(id)?.group.rotation.y ?? h.world().entities.get(id)?.facing ?? null,
    (id, hand) => {
      const root = h.views.get(id)?.group;
      return root ? weaponTrailAnchor(root, hand) : null;
    },
    (id, hand, out) => {
      const root = visual(id)?.root;
      return root ? sampleHandAnchor(root, hand, out) : false;
    },
    h.textureReady,
    (id, piece, out) => {
      const root = visual(id)?.root;
      return root ? sampleWarriorPowerBone(root, piece, out) : false;
    },
    (id, hand) => {
      const entity = h.world().entities.get(id);
      const itemId = hand === 0 ? entity?.mainhandItemId : entity?.offhandItemId;
      return !!itemId && ITEMS[itemId]?.kind === 'weapon';
    },
  );
  fx.setViewportScale(h.height() * h.pixelRatio(), 60, h.height());
  fx.setSpiritBuildScheduler(h.spiritBuild);
  fx.setSpiritCompileGate(h.compile);
  fx.onRushArrival = createOnrushArrivalHandler(() => h.world().entities, h.views, h.visual);
  fx.setWorldLightDelegate((at, school, intensity, duration, range) =>
    h.light.pulse(at, school, intensity, duration, range),
  );
  const painter = new AbilityVfx(
    {
      ...h.painter,
      vfx: h.vfx,
      fx,
      anchor: h.anchor,
      setAuraGlow: (id, color, intensity) => visual(id)?.setAuraGlow(color, intensity),
      playShoutAnim: (id) => {
        const rig = visual(id);
        if (rig && !rig.isMidOneShot) rig.playEmote('cheer', 1);
      },
      isMob: (id) => h.world().entities.get(id)?.kind === 'mob',
      castingAbilityOf: (id) => h.world().entities.get(id)?.castingAbility ?? null,
      isMidOneShot: (id) => !!visual(id)?.isMidOneShot,
      localPlayerId: () => h.world().player.id,
      warriorSpecOf: (id) => (id === h.world().playerId ? h.world().talentSpec : null),
      isLivingWarrior: (id) => isLivingWarriorAttentionSource(h.world().entities.get(id)),
      isWarrior: (id) => {
        const entity = h.world().entities.get(id);
        return entity?.kind === 'player' && entity.templateId === 'warrior';
      },
      // A remote Warrior's kit (textures, contact sheets, crests) loads the first
      // time the painter sees one; a local Warrior's is resumed by the renderer.
      requestClassKit: (cls) => resumeActiveAbilityKit(h.scene, undefined, cls),
      hasGestureClip: (id, abilityId) => visual(id)?.hasAttackClipOverride(abilityId) ?? false,
      isInstantAbility: (id) => {
        const def = ABILITIES[id];
        return !def || (def.castTime <= 0 && !def.channel && !def.empowerStages);
      },
      animHold: (id, scale, duration) => visual(id)?.holdFrame(scale, duration),
      bodyLean: (id, amount) => visual(id)?.setWindupLean(amount),
      audioReady: (key) => preparedAbilityAudio(h.audio(), key),
      abilityAudio: (kind, palette, power, x, y, z, opts) =>
        h.audio()?.abilityAudio?.(kind, palette, power, x, y, z, opts),
    },
    h.time,
  );
  fx.onContact = (source, target, school, weight, abilityId, beat) => {
    const entity = h.world().entities.get(source);
    if (entity?.kind !== 'player' || entity.templateId !== 'warrior') return;
    impactContact(
      visual(target),
      school,
      weight,
      beat !== 0 && source === h.world().playerId,
      h.reducedMotion(),
      abilityId,
      false,
      beat,
      h.views.get(source)?.group.position,
    );
  };
  return { fx, painter };
}
