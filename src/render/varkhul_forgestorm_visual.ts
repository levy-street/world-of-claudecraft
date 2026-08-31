// Authoritative Forgestorm ground warnings. The encounter snapshot owns the
// positions, radius, and countdown; this painter only turns that contract into
// a persistent danger decal. It intentionally has no graphics-tier input:
// avoiding these circles is gameplay, so Low and Ultra render identical
// actionable geometry.

import * as THREE from 'three';
import type { ActiveVarkhulAssembly } from '../sim/varkhul_assembly';
import type {
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from '../sim/varkhul_cinder_orbs';
import type { ActiveVarkhulForgestormWarning } from '../sim/varkhul_forgestorm';
import {
  type VarkhulAssemblyViewerFocus,
  varkhulAssemblyViewerFocusInto,
} from './varkhul_assembly_focus_core';
import { VarkhulAssemblyVisuals } from './varkhul_assembly_visual';
import { VarkhulCinderOrbVisuals } from './varkhul_cinder_orb_visual';
import { VarkhulForgeBeamVisuals } from './varkhul_forge_beam_visual';
import { VarkhulInterceptBeamVisuals } from './varkhul_intercept_beam_visual';
import { VarkhulWorldfireVisuals } from './varkhul_worldfire_visual';

const SEGMENTS = 64;
const GROUND_LIFT = 0.09;
const RIM_INNER_FRACTION = 0.84;
const FORGESTORM_COLOR = 0xff4b16;
const FORGESTORM_EDGE_COLOR = 0xffb12b;
const METEOR_START_HEIGHT = 18;
const METEOR_IMPACT_HEIGHT = 0.55;
const METEOR_TRAIL_OFFSET = 3.1;

interface ForgestormVisual {
  group: THREE.Group;
  rimMaterial: THREE.MeshBasicMaterial;
  fillMaterial: THREE.MeshBasicMaterial;
  countdownMaterial: THREE.MeshBasicMaterial;
  countdown: THREE.Mesh;
  meteorMaterial: THREE.MeshBasicMaterial;
  meteor: THREE.Mesh;
  trailMaterial: THREE.MeshBasicMaterial;
  trail: THREE.Mesh;
  remaining: number;
  duration: number;
  phase: number;
}

export function buildVarkhulForgestormTelegraph(
  warning: ActiveVarkhulForgestormWarning,
  groundY: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'varkhul-forgestorm-warning';
  group.position.set(warning.x, groundY + GROUND_LIFT, warning.z);
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.warningId = warning.id;
  group.userData.sourceId = warning.sourceId;
  group.userData.radius = warning.radius;

  const rimMaterial = new THREE.MeshBasicMaterial({
    color: FORGESTORM_EDGE_COLOR,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(warning.radius * RIM_INNER_FRACTION, warning.radius, SEGMENTS).rotateX(
      -Math.PI / 2,
    ),
    rimMaterial,
  );
  rim.name = 'varkhul-forgestorm-rim';
  rim.renderOrder = 11;
  group.add(rim);

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: FORGESTORM_COLOR,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(warning.radius * RIM_INNER_FRACTION, SEGMENTS).rotateX(-Math.PI / 2),
    fillMaterial,
  );
  fill.name = 'varkhul-forgestorm-fill';
  fill.position.y = 0.01;
  fill.renderOrder = 10;
  group.add(fill);

  const countdownMaterial = new THREE.MeshBasicMaterial({
    color: FORGESTORM_EDGE_COLOR,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const countdown = new THREE.Mesh(
    new THREE.CircleGeometry(warning.radius * RIM_INNER_FRACTION, SEGMENTS).rotateX(-Math.PI / 2),
    countdownMaterial,
  );
  countdown.name = 'varkhul-forgestorm-countdown';
  countdown.position.y = 0.025;
  countdown.scale.set(0.001, 1, 0.001);
  countdown.renderOrder = 12;
  group.add(countdown);

  const meteorMaterial = new THREE.MeshBasicMaterial({
    color: 0xff7a16,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const meteor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), meteorMaterial);
  meteor.name = 'varkhul-forgestorm-meteor';
  meteor.position.y = METEOR_START_HEIGHT;
  meteor.renderOrder = 14;
  group.add(meteor);

  const trailMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb12b,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  trailMaterial.forceSinglePass = true;
  const trail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 6.2, 9, 1, true), trailMaterial);
  trail.name = 'varkhul-forgestorm-meteor-trail';
  trail.position.y = METEOR_START_HEIGHT + METEOR_TRAIL_OFFSET;
  trail.renderOrder = 13;
  group.add(trail);

  group.userData.rimMaterial = rimMaterial;
  group.userData.fillMaterial = fillMaterial;
  group.userData.countdownMaterial = countdownMaterial;
  group.userData.countdown = countdown;
  group.userData.meteorMaterial = meteorMaterial;
  group.userData.meteor = meteor;
  group.userData.trailMaterial = trailMaterial;
  group.userData.trail = trail;
  return group;
}

function disposeVisual(visual: ForgestormVisual): void {
  visual.group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  visual.rimMaterial.dispose();
  visual.fillMaterial.dispose();
  visual.countdownMaterial.dispose();
  visual.meteorMaterial.dispose();
  visual.trailMaterial.dispose();
  visual.group.removeFromParent();
}

export class VarkhulForgestormVisuals {
  private readonly visuals = new Map<string, ForgestormVisual>();
  private readonly activeIds = new Set<string>();
  private readonly cinderOrbVisuals: VarkhulCinderOrbVisuals;
  private readonly forgeBeamVisuals: VarkhulForgeBeamVisuals;
  private readonly interceptBeamVisuals: VarkhulInterceptBeamVisuals;
  private readonly worldfireVisuals: VarkhulWorldfireVisuals;
  private readonly assemblyVisuals: VarkhulAssemblyVisuals;
  // Per-frame scratch for the assembly viewer focus (the sync path is
  // allocation-free by the render hot-path rule).
  private readonly assemblyViewerFocus: VarkhulAssemblyViewerFocus = {
    playerId: Number.MIN_SAFE_INTEGER,
    x: 0,
    z: 0,
    assignedSymbol: null,
  };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    this.cinderOrbVisuals = new VarkhulCinderOrbVisuals(scene, groundY);
    this.forgeBeamVisuals = new VarkhulForgeBeamVisuals(scene, groundY);
    this.interceptBeamVisuals = new VarkhulInterceptBeamVisuals(scene, groundY);
    this.worldfireVisuals = new VarkhulWorldfireVisuals(scene, groundY);
    this.assemblyVisuals = new VarkhulAssemblyVisuals(scene, groundY);
  }

  sync(
    warnings: readonly ActiveVarkhulForgestormWarning[],
    cinderFires: readonly ActiveVarkhulCinderFire[] = [],
    cinderOrbProjectiles: readonly ActiveVarkhulCinderOrbProjectile[] = [],
  ): void {
    this.cinderOrbVisuals.sync(cinderFires, cinderOrbProjectiles);
    if (warnings.length === 0 && this.visuals.size === 0) return;
    this.activeIds.clear();
    for (const warning of warnings) {
      this.activeIds.add(warning.id);
      let visual = this.visuals.get(warning.id);
      if (!visual) {
        const group = buildVarkhulForgestormTelegraph(warning, this.groundY(warning.x, warning.z));
        visual = {
          group,
          rimMaterial: group.userData.rimMaterial as THREE.MeshBasicMaterial,
          fillMaterial: group.userData.fillMaterial as THREE.MeshBasicMaterial,
          countdownMaterial: group.userData.countdownMaterial as THREE.MeshBasicMaterial,
          countdown: group.userData.countdown as THREE.Mesh,
          meteorMaterial: group.userData.meteorMaterial as THREE.MeshBasicMaterial,
          meteor: group.userData.meteor as THREE.Mesh,
          trailMaterial: group.userData.trailMaterial as THREE.MeshBasicMaterial,
          trail: group.userData.trail as THREE.Mesh,
          remaining: warning.remaining,
          duration: warning.duration,
          phase: 0,
        };
        this.scene.add(group);
        this.visuals.set(warning.id, visual);
      }
      visual.remaining = warning.remaining;
      visual.duration = warning.duration;
    }
    for (const [id, visual] of this.visuals) {
      if (this.activeIds.has(id)) continue;
      disposeVisual(visual);
      this.visuals.delete(id);
    }
  }

  syncWorld(world: {
    activeVarkhulForgestormWarnings: readonly ActiveVarkhulForgestormWarning[];
    activeVarkhulCinderFires: readonly ActiveVarkhulCinderFire[];
    activeVarkhulCinderOrbProjectiles: readonly ActiveVarkhulCinderOrbProjectile[];
    activeVarkhulAssemblies: readonly ActiveVarkhulAssembly[];
    player: {
      id: number;
      pos: { x: number; z: number };
      auras: readonly { id: string; sourceId: number; stacks?: number }[];
    };
    entities: ReadonlyMap<
      number,
      { auras: readonly { id: string; remaining: number; duration: number }[] }
    >;
  }): void {
    this.forgeBeamVisuals.sync(world.activeVarkhulAssemblies);
    this.interceptBeamVisuals.sync(world.activeVarkhulAssemblies);
    this.worldfireVisuals.sync(world.activeVarkhulAssemblies, world.entities);
    this.assemblyVisuals.sync(
      world.activeVarkhulAssemblies,
      varkhulAssemblyViewerFocusInto(
        world.activeVarkhulAssemblies,
        world.player,
        this.assemblyViewerFocus,
      ),
    );
    this.sync(
      world.activeVarkhulForgestormWarnings,
      world.activeVarkhulCinderFires,
      world.activeVarkhulCinderOrbProjectiles,
    );
  }

  update(dt: number, reducedMotion = false): void {
    this.cinderOrbVisuals.update(dt, reducedMotion);
    this.forgeBeamVisuals.update(dt, reducedMotion);
    this.interceptBeamVisuals.update(dt, reducedMotion);
    this.worldfireVisuals.update(dt, reducedMotion);
    this.assemblyVisuals.update(dt, reducedMotion);
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) {
        visual.phase = (visual.phase + Math.max(0, dt) * 5) % (Math.PI * 2);
      }
      const duration = Math.max(0.05, visual.duration);
      const elapsedFraction = THREE.MathUtils.clamp(1 - visual.remaining / duration, 0, 1);
      const descent = elapsedFraction * elapsedFraction * (3 - 2 * elapsedFraction);
      const meteorY = THREE.MathUtils.lerp(METEOR_START_HEIGHT, METEOR_IMPACT_HEIGHT, descent);
      visual.meteor.position.y = meteorY;
      visual.trail.position.y = meteorY + METEOR_TRAIL_OFFSET;
      visual.trail.scale.y = 0.78 + elapsedFraction * 0.36;
      visual.meteorMaterial.opacity = 0.82 + elapsedFraction * 0.16;
      visual.trailMaterial.opacity = 0.42 + elapsedFraction * 0.24;
      if (!reducedMotion) {
        visual.meteor.rotation.x += Math.max(0, dt) * 3.4;
        visual.meteor.rotation.z += Math.max(0, dt) * 2.1;
      }
      const countdownScale = Math.max(0.001, elapsedFraction);
      visual.countdown.scale.set(countdownScale, 1, countdownScale);
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(visual.phase);
      visual.rimMaterial.opacity = 0.76 + pulse * 0.2;
      visual.fillMaterial.opacity = 0.13 + elapsedFraction * 0.12;
      visual.countdownMaterial.opacity = 0.2 + elapsedFraction * 0.3;
    }
  }

  dispose(): void {
    this.cinderOrbVisuals.dispose();
    this.forgeBeamVisuals.dispose();
    this.interceptBeamVisuals.dispose();
    this.worldfireVisuals.dispose();
    this.assemblyVisuals.dispose();
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeIds.clear();
  }
}
