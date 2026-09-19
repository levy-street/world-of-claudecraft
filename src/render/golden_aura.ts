// The Golden Aura keepsake's surrounding glow (Founder's Pack Epic tier,
// src/sim/content/items.ts founder_golden_aura): a ring of warm gold light
// drawn on the ground around every character with the cosmetic toggled on
// (Entity.goldenAuraActive). CharacterVisual.setGoldenAura (visual.ts) owns
// the matching whole-body gold tint; this module is only the surrounding
// halo, same split as mob_night_glow.ts (a ground effect) versus a rig tint.
//
// One pooled InstancedMesh for the whole scene (one additive draw), same
// recipe as mob_night_glow.ts: the renderer hands this `emit` its live
// entity views once a frame and the walk lives here so the coordinator keeps
// a single call. The per-frame path allocates nothing; a body past the pool
// cap simply goes without a ring, which is the crowd-safe failure mode (the
// ring is cosmetic, never a gameplay signal, so a dropped instance is fine).
import * as THREE from 'three';
import { radialGlowTexture } from './textures';

/** Pool cap: this is a rare account cosmetic, never a crowd effect. */
const GOLDEN_AURA_POOL = 24;
/** World yards of the unit ring texture; each instance scales it to its body. */
const RING_RADIUS = 1.0;
/** Default ring radius in world yards for a scale-1 body, scaled per body. */
const GOLDEN_AURA_RING_RADIUS = 1.15;
const RING_SEGMENTS = 20;
/** Above the ground sample, matching the selection ring's drape lift. */
const LIFT = 0.1;
const GLOW_COLOR = 0xffc830;
const MAX_OPACITY = 0.55;

/**
 * The read-only slice of one entity view this layer reads. The renderer's own
 * view map satisfies it structurally, so nothing has to be adapted at the
 * call site (the vale_cup_team_ring.ts contract).
 *
 * `group.position.y` is the body's DRAWN feet height, matching mob_night_glow's
 * own rationale: flush with a body on a dock, a bridge, or a step the
 * smoother is still easing.
 */
export interface GoldenAuraBodyView {
  group: { visible: boolean; position: { x: number; y: number; z: number } };
}

/** The read-only slice of the sim entity behind a view. */
export interface GoldenAuraBodyEntity {
  kind: string;
  scale: number;
  goldenAuraActive?: boolean;
}

export interface GoldenAuraView {
  group: THREE.Group;
  /** Redraw every visible aura-active body's ring for this frame. */
  emit(
    views: Iterable<[number, GoldenAuraBodyView]>,
    entities: { get(id: number): GoldenAuraBodyEntity | undefined },
  ): void;
}

export function buildGoldenAura(): GoldenAuraView {
  const group = new THREE.Group();
  group.name = 'golden-aura';

  const geometry = new THREE.RingGeometry(RING_RADIUS * 0.72, RING_RADIUS, RING_SEGMENTS).rotateX(
    -Math.PI / 2,
  );
  const material = new THREE.MeshBasicMaterial({
    map: radialGlowTexture(),
    color: GLOW_COLOR,
    transparent: true,
    opacity: MAX_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, GOLDEN_AURA_POOL);
  // Instances are rewritten every frame from anywhere in the draw band, so a
  // baked bounding sphere is stale the moment it is computed.
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // over the ground, under the world's own decals
  mesh.count = 0;
  const identity = new THREE.Matrix4();
  for (let i = 0; i < GOLDEN_AURA_POOL; i++) mesh.setMatrixAt(i, identity);
  group.add(mesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  let count = 0;

  const add = (x: number, feetY: number, z: number, radius: number): void => {
    if (count >= GOLDEN_AURA_POOL) return;
    position.set(x, feetY + LIFT, z);
    scale.set(radius, 1, radius);
    mesh.setMatrixAt(count, matrix.compose(position, quaternion, scale));
    count++;
  };

  return {
    group,
    emit(views, entities): void {
      count = 0;
      for (const [id, view] of views) {
        if (!view.group.visible) continue;
        const entity = entities.get(id);
        if (!entity || entity.kind === 'object' || !entity.goldenAuraActive) continue;
        const radius = GOLDEN_AURA_RING_RADIUS * Math.max(0.5, entity.scale);
        add(view.group.position.x, view.group.position.y, view.group.position.z, radius);
      }
      group.visible = count > 0;
      mesh.count = count;
      if (count === 0) return;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
