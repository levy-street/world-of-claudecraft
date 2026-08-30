import * as THREE from 'three';
import {
  IGNIVAR_BRAND_RADIUS,
  IGNIVAR_SKYFIRE_CONE_COUNT,
  IGNIVAR_SKYFIRE_HALF_ANGLE,
  IGNIVAR_SKYFIRE_RANGE,
} from '../sim/encounters/ignivar';
import { IGNIVAR_BOSS_ID } from '../sim/types';
import {
  buildIgnivarBrandTelegraph,
  IGNIVAR_BRAND_VISUAL_NAME,
  syncIgnivarBrandTelegraph,
} from './ignivar_brand_telegraph';
import { type IgnivarVisualEntity, ignivarEncounterVisualPlan } from './ignivar_encounter_core';
import {
  buildIgnivarForgeChainVisual,
  disposeIgnivarForgeChainVisual,
  IGNIVAR_FORGE_CHAIN_VISUAL_NAME,
  type IgnivarForgeChainVisualEntity,
  type IgnivarForgeChainVisualPosition,
  type IgnivarForgeChainVisualView,
  syncIgnivarForgeChainVisual,
} from './ignivar_forge_chains';
import {
  buildIgnivarForgeJudgmentVisual,
  IGNIVAR_JUDGMENT_VISUAL_NAME,
  syncIgnivarForgeJudgmentVisual,
} from './ignivar_forge_judgment';
import {
  buildIgnivarForgeWaveVisual,
  IGNIVAR_FORGE_WAVE_VISUAL_NAME,
  syncIgnivarForgeWaveVisual,
} from './ignivar_forge_wave';
import {
  buildIgnivarFrontalTelegraph,
  IGNIVAR_FRONTAL_VISUAL_NAME,
  syncIgnivarFrontalTelegraph,
} from './ignivar_frontal_telegraph';
import { disposeIgnivarModelVfx, syncIgnivarModelVfx } from './ignivar_model_vfx';
import {
  buildIgnivarRotatingRaysTelegraph,
  IGNIVAR_ROTATING_RAYS_VISUAL_NAME,
  syncIgnivarRotatingRaysTelegraph,
} from './ignivar_rotating_rays';
import type { Vfx } from './vfx';

export {
  buildIgnivarBrandTelegraph as buildIgnivarBrandCircle,
  IGNIVAR_BRAND_VISUAL_NAME,
} from './ignivar_brand_telegraph';
export {
  buildIgnivarFrontalTelegraph,
  IGNIVAR_FRONTAL_VISUAL_NAME,
} from './ignivar_frontal_telegraph';
export {
  buildIgnivarRotatingRaysTelegraph,
  IGNIVAR_ROTATING_RAYS_VISUAL_NAME,
} from './ignivar_rotating_rays';
export const IGNIVAR_SKYFIRE_VISUAL_NAME = 'ignivarSkyfireTelegraph';

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}

function disposeOwnedVisual(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Line;
    if ((renderable as THREE.InstancedMesh).isInstancedMesh) {
      (renderable as THREE.InstancedMesh).dispose();
    }
    if ('geometry' in renderable && renderable.geometry) renderable.geometry.dispose();
    if ('material' in renderable && renderable.material) disposeMaterial(renderable.material);
  });
  root.removeFromParent();
}

function encounterMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function buildIgnivarSkyfireTelegraph(): THREE.Group {
  const group = new THREE.Group();
  group.name = IGNIVAR_SKYFIRE_VISUAL_NAME;
  const segments = 18;
  for (let cone = 0; cone < IGNIVAR_SKYFIRE_CONE_COUNT; cone++) {
    const offset = (cone * Math.PI * 2) / IGNIVAR_SKYFIRE_CONE_COUNT;
    const positions: number[] = [0, 0.052, 0];
    for (let i = 0; i <= segments; i++) {
      const angle =
        offset - IGNIVAR_SKYFIRE_HALF_ANGLE + (i / segments) * IGNIVAR_SKYFIRE_HALF_ANGLE * 2;
      positions.push(
        Math.sin(angle) * IGNIVAR_SKYFIRE_RANGE,
        0.052,
        Math.cos(angle) * IGNIVAR_SKYFIRE_RANGE,
      );
    }
    const indices: number[] = [];
    for (let i = 0; i < segments; i++) indices.push(0, i + 1, i + 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    group.add(new THREE.Mesh(geometry, encounterMaterial(0xff5a12, 0.3)));

    const rimPoints: THREE.Vector3[] = [new THREE.Vector3(0, 0.075, 0)];
    for (let i = 0; i <= segments; i++) {
      const angle =
        offset - IGNIVAR_SKYFIRE_HALF_ANGLE + (i / segments) * IGNIVAR_SKYFIRE_HALF_ANGLE * 2;
      rimPoints.push(
        new THREE.Vector3(
          Math.sin(angle) * IGNIVAR_SKYFIRE_RANGE,
          0.075,
          Math.cos(angle) * IGNIVAR_SKYFIRE_RANGE,
        ),
      );
    }
    rimPoints.push(new THREE.Vector3(0, 0.075, 0));
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rimPoints),
        new THREE.LineBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.95 }),
      ),
    );
  }
  group.userData.renderCategory = 'ui3d';
  group.visible = false;
  return group;
}

/**
 * Stages the per-entity Ignivar mechanic materials before the boss is pulled.
 * These visuals are otherwise built lazily during per-frame encounter sync,
 * AFTER the view's compile-gate enumeration, so their first onset would link
 * programs inside a live frame. The rotating rays and Forge Judgment have
 * their own prewarm builders: each stages several full fire-beam lanes, so
 * sharing this unit would concatenate the builds into one long task.
 */
export function buildIgnivarEncounterPrewarmVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'ignivar-encounter-prewarm-entity';
  const visuals = [
    buildIgnivarFrontalTelegraph(),
    buildIgnivarSkyfireTelegraph(),
    buildIgnivarBrandTelegraph(),
    buildIgnivarForgeChainVisual(),
    buildIgnivarForgeWaveVisual(),
  ];
  for (let index = 0; index < visuals.length; index++) {
    const visual = visuals[index];
    visual.visible = true;
    visual.position.x = (index - 2) * 3;
    visual.traverse((child) => {
      child.visible = true;
    });
    root.add(visual);
  }
  return root;
}

/** Releases the per-entity encounter overlays before a character view is pooled. */
export function disposeIgnivarEncounterVisuals(group: THREE.Group): void {
  disposeIgnivarModelVfx(group);
  const chain = group.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME);
  if (chain) disposeIgnivarForgeChainVisual(chain);
  for (const name of [
    IGNIVAR_FRONTAL_VISUAL_NAME,
    IGNIVAR_BRAND_VISUAL_NAME,
    IGNIVAR_SKYFIRE_VISUAL_NAME,
    IGNIVAR_ROTATING_RAYS_VISUAL_NAME,
    IGNIVAR_FORGE_WAVE_VISUAL_NAME,
    IGNIVAR_JUDGMENT_VISUAL_NAME,
  ]) {
    const visual = group.getObjectByName(name);
    if (visual) disposeOwnedVisual(visual);
  }
}

/** Keeps one offscreen cleanup frame alive after an arena telegraph ends. */
export function hasVisibleIgnivarEncounterTelegraph(group: THREE.Group): boolean {
  for (const name of [
    IGNIVAR_FRONTAL_VISUAL_NAME,
    IGNIVAR_SKYFIRE_VISUAL_NAME,
    IGNIVAR_ROTATING_RAYS_VISUAL_NAME,
    IGNIVAR_FORGE_WAVE_VISUAL_NAME,
    IGNIVAR_JUDGMENT_VISUAL_NAME,
  ]) {
    if (group.getObjectByName(name)?.visible) return true;
  }
  return false;
}

/**
 * Keeps the actionable player-to-player chain independent from character rig loading.
 * The renderer calls this before its unloaded-rig early return so the Heroic cue cannot
 * disappear while a player or dev-bot model is still compiling.
 */
export function syncIgnivarPlayerChainVisual(
  group: THREE.Group,
  entity: IgnivarVisualEntity,
  chainViews: ReadonlyMap<number, IgnivarForgeChainVisualView>,
  dt = 0,
  chainEntities?: ReadonlyMap<number, IgnivarForgeChainVisualPosition>,
  reducedMotion = false,
): void {
  if (entity.kind !== 'player' || entity.id === undefined) return;
  syncIgnivarForgeChainVisual(
    group,
    entity as IgnivarForgeChainVisualEntity,
    chainViews,
    dt,
    chainEntities,
    reducedMotion,
  );
}

/** Lazily adds and toggles encounter telegraphs on existing entity groups. */
export function syncIgnivarEncounterVisuals(
  group: THREE.Group,
  entity: IgnivarVisualEntity,
  dt = 0,
  vfx?: Vfx,
  bodyRoot?: THREE.Object3D,
  syncModelVfx = true,
  chainViews?: ReadonlyMap<number, IgnivarForgeChainVisualView>,
  encounterEntities?: ReadonlyMap<
    number,
    IgnivarVisualEntity & { pos?: { x: number; z: number }; dead?: boolean }
  >,
  reducedMotion = false,
): void {
  if (entity.templateId !== IGNIVAR_BOSS_ID && entity.kind !== 'player') return;
  const plan = ignivarEncounterVisualPlan(entity);
  if (entity.templateId === IGNIVAR_BOSS_ID) {
    const bodyLock = group.userData.ignivarRotatingRaysBodyLock as
      | { baseRotation: number; groupFacing: number; worldFacing: number }
      | undefined;
    if (bodyRoot && plan.rotatingRaysVisible) {
      let lock = bodyLock;
      if (!lock) {
        lock = {
          baseRotation: bodyRoot.rotation.y,
          groupFacing: group.rotation.y,
          worldFacing: group.rotation.y + bodyRoot.rotation.y,
        };
        group.userData.ignivarRotatingRaysBodyLock = lock;
      }
      bodyRoot.rotation.y = lock.worldFacing - group.rotation.y;
    } else if (bodyRoot && bodyLock) {
      bodyRoot.rotation.y = bodyLock.baseRotation;
      delete group.userData.ignivarRotatingRaysBodyLock;
    }
    if (syncModelVfx) {
      syncIgnivarModelVfx(group, dt, vfx, {
        dead: entity.dead,
        castingAbility: entity.castingAbility,
        channeling: entity.channeling,
      });
    }
    let frontal = group.getObjectByName(IGNIVAR_FRONTAL_VISUAL_NAME);
    if (!frontal) {
      frontal = buildIgnivarFrontalTelegraph();
      group.add(frontal);
    }
    syncIgnivarFrontalTelegraph(
      frontal,
      plan.frontalVisible,
      plan.frontalProgress,
      plan.inverseEntityScale,
      dt,
    );

    let skyfire = group.getObjectByName(IGNIVAR_SKYFIRE_VISUAL_NAME);
    if (!skyfire) {
      skyfire = buildIgnivarSkyfireTelegraph();
      group.add(skyfire);
    }
    skyfire.scale.setScalar(plan.inverseEntityScale);
    skyfire.visible = plan.skyfireVisible;

    let rotatingRays = group.getObjectByName(IGNIVAR_ROTATING_RAYS_VISUAL_NAME);
    if (!rotatingRays) {
      rotatingRays = buildIgnivarRotatingRaysTelegraph();
      group.add(rotatingRays);
    }
    syncIgnivarRotatingRaysTelegraph(
      rotatingRays,
      plan.rotatingRaysPhase,
      plan.rotatingRaysWindupProgress,
      plan.inverseEntityScale,
    );

    let forgeWave = group.getObjectByName(IGNIVAR_FORGE_WAVE_VISUAL_NAME);
    if (!forgeWave) {
      forgeWave = buildIgnivarForgeWaveVisual();
      group.add(forgeWave);
    }
    syncIgnivarForgeWaveVisual(
      forgeWave,
      plan.forgeWavePhase,
      plan.forgeWaveProgress,
      plan.forgeWaveRadius,
      plan.inverseEntityScale,
    );

    let judgment = group.getObjectByName(IGNIVAR_JUDGMENT_VISUAL_NAME);
    if (!judgment) {
      judgment = buildIgnivarForgeJudgmentVisual();
      group.add(judgment);
    }
    // The three random shelters remain fixed in arena space even though the
    // boss facing carries their reconnect-safe layout rotation.
    judgment.rotation.y = -group.rotation.y;
    syncIgnivarForgeJudgmentVisual(
      judgment,
      plan.judgmentPhase,
      plan.judgmentRotation,
      plan.judgmentSafeIndex,
      plan.inverseEntityScale,
      plan.judgmentCueIntensity,
      plan.judgmentCueRevealed,
    );
    vfx?.syncIgnivarJudgmentGroundFire(
      entity.id ?? 0,
      plan.judgmentPhase === 'active',
      group.position.x,
      group.position.y,
      group.position.z,
      group.position.x + Number(judgment.userData.ignivarSafeOffsetX ?? 0),
      group.position.z + Number(judgment.userData.ignivarSafeOffsetZ ?? 0),
      dt,
    );
  }

  if (entity.kind !== 'player') return;
  let circle = group.getObjectByName(IGNIVAR_BRAND_VISUAL_NAME);
  if (!circle && plan.branded) {
    circle = buildIgnivarBrandTelegraph();
    group.add(circle);
  }
  if (circle) {
    let nearbyPlayers = 0;
    const entityPosition = (entity as IgnivarVisualEntity & { pos?: { x: number; z: number } }).pos;
    if (plan.branded && entityPosition && encounterEntities && entity.id !== undefined) {
      for (const [id, candidate] of encounterEntities) {
        if (id === entity.id || candidate.kind !== 'player' || candidate.dead || !candidate.pos)
          continue;
        if (
          Math.hypot(candidate.pos.x - entityPosition.x, candidate.pos.z - entityPosition.z) <=
          IGNIVAR_BRAND_RADIUS
        ) {
          nearbyPlayers++;
        }
      }
    }
    syncIgnivarBrandTelegraph(
      circle,
      plan.branded,
      plan.brandStacks,
      nearbyPlayers,
      plan.inverseEntityScale,
      dt,
      reducedMotion,
    );
  }

  if (chainViews && entity.id !== undefined) {
    syncIgnivarPlayerChainVisual(group, entity, chainViews, dt, undefined, reducedMotion);
  }
}
