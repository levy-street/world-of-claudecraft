// Soul Rend marker: the painter. One marker per marked raider, driven by the
// mirrored aura so the online client gets it for free: a floor ring at the
// exact stack range with a faint fill (so overlapping rings read at a glance),
// and a sigil floating over the head (a spinning torus with a crossed blade
// inside it) so a marked raider can be found across the room. Both turn from
// red to green the moment another mark is inside the ring: green means stay,
// red means move. Everything actionable here is tier-independent; the pulse
// and spin are the only cosmetics and reduced motion holds them.

import * as THREE from 'three';
import {
  NYTHRAXIS_SOUL_REND_MARKER_GROUND_LIFT,
  NYTHRAXIS_SOUL_REND_MARKER_RADIUS,
  NYTHRAXIS_SOUL_REND_SIGIL_BOB,
  NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT,
  type NythraxisSoulRendEntityLike,
  type NythraxisSoulRendMarkerPalette,
  nythraxisSoulRendMarkedInto,
  nythraxisSoulRendMarkOf,
  nythraxisSoulRendPalette,
  nythraxisSoulRendPartners,
  nythraxisSoulRendPulse,
} from './nythraxis_soul_rend_marker_core';

export const NYTHRAXIS_SOUL_REND_MARKER_NAME = 'nythraxis-soul-rend-marker';
export const NYTHRAXIS_SOUL_REND_RING_NAME = 'nythraxis-soul-rend-ring';
export const NYTHRAXIS_SOUL_REND_FILL_NAME = 'nythraxis-soul-rend-fill';
export const NYTHRAXIS_SOUL_REND_SIGIL_NAME = 'nythraxis-soul-rend-sigil';
export const NYTHRAXIS_SOUL_REND_SIGIL_RING_NAME = 'nythraxis-soul-rend-sigil-ring';
export const NYTHRAXIS_SOUL_REND_SIGIL_BLADE_NAME = 'nythraxis-soul-rend-sigil-blade';

const RING_SEGMENTS = 64;
const RING_WIDTH = 0.22;
const SIGIL_RADIUS = 0.42;
const SIGIL_SPIN = 1.4; // rad/s
const RING_OPACITY = 0.9;
const FILL_OPACITY = 0.16;
const SIGIL_OPACITY = 0.92;

// Shared geometry: every marker is the same shape, only its transform and colour differ.
const RING_GEOMETRY = new THREE.RingGeometry(
  NYTHRAXIS_SOUL_REND_MARKER_RADIUS - RING_WIDTH,
  NYTHRAXIS_SOUL_REND_MARKER_RADIUS,
  RING_SEGMENTS,
).rotateX(-Math.PI / 2);
const FILL_GEOMETRY = new THREE.CircleGeometry(
  NYTHRAXIS_SOUL_REND_MARKER_RADIUS - RING_WIDTH,
  RING_SEGMENTS,
).rotateX(-Math.PI / 2);
const SIGIL_RING_GEOMETRY = new THREE.TorusGeometry(SIGIL_RADIUS, 0.05, 8, 32);
const SIGIL_BLADE_GEOMETRY = new THREE.OctahedronGeometry(SIGIL_RADIUS * 0.55, 0);

function markerMaterial(
  color: number,
  opacity: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

interface MarkerVisual {
  group: THREE.Group;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  sigil: THREE.Group;
  sigilRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  sigilBlade: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  palette: NythraxisSoulRendMarkerPalette | null;
  partners: number;
  remaining: number;
  duration: number;
  phase: number;
}

/** One marker, at the origin, coloured for a raider standing alone. */
export function buildNythraxisSoulRendMarker(): THREE.Group {
  const group = new THREE.Group();
  group.name = NYTHRAXIS_SOUL_REND_MARKER_NAME;
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.radius = NYTHRAXIS_SOUL_REND_MARKER_RADIUS;

  const palette = nythraxisSoulRendPalette(0);
  const ring = new THREE.Mesh(RING_GEOMETRY, markerMaterial(palette.ring, RING_OPACITY));
  ring.name = NYTHRAXIS_SOUL_REND_RING_NAME;
  ring.position.y = NYTHRAXIS_SOUL_REND_MARKER_GROUND_LIFT + 0.01;
  ring.renderOrder = 16;
  ring.userData.actionable = true;
  group.add(ring);

  const fill = new THREE.Mesh(
    FILL_GEOMETRY,
    markerMaterial(palette.fill, FILL_OPACITY, THREE.NormalBlending),
  );
  fill.name = NYTHRAXIS_SOUL_REND_FILL_NAME;
  fill.position.y = NYTHRAXIS_SOUL_REND_MARKER_GROUND_LIFT;
  fill.renderOrder = 15;
  group.add(fill);

  const sigil = new THREE.Group();
  sigil.name = NYTHRAXIS_SOUL_REND_SIGIL_NAME;
  sigil.position.y = NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT;
  const sigilRing = new THREE.Mesh(
    SIGIL_RING_GEOMETRY,
    markerMaterial(palette.sigil, SIGIL_OPACITY),
  );
  sigilRing.name = NYTHRAXIS_SOUL_REND_SIGIL_RING_NAME;
  sigilRing.rotation.x = Math.PI / 2;
  sigilRing.renderOrder = 17;
  const sigilBlade = new THREE.Mesh(
    SIGIL_BLADE_GEOMETRY,
    markerMaterial(palette.sigil, SIGIL_OPACITY),
  );
  sigilBlade.name = NYTHRAXIS_SOUL_REND_SIGIL_BLADE_NAME;
  sigilBlade.scale.set(0.55, 1.35, 0.55);
  sigilBlade.renderOrder = 17;
  sigil.add(sigilRing, sigilBlade);
  group.add(sigil);

  group.userData.ring = ring;
  group.userData.fill = fill;
  group.userData.sigil = sigil;
  group.userData.sigilRing = sigilRing;
  group.userData.sigilBlade = sigilBlade;
  return group;
}

function applyPalette(visual: MarkerVisual, palette: NythraxisSoulRendMarkerPalette): void {
  if (visual.palette === palette) return;
  visual.palette = palette;
  visual.ring.material.color.setHex(palette.ring);
  visual.fill.material.color.setHex(palette.fill);
  visual.sigilRing.material.color.setHex(palette.sigil);
  visual.sigilBlade.material.color.setHex(palette.sigil);
  visual.group.userData.stacked = palette !== nythraxisSoulRendPalette(0);
}

function disposeVisual(visual: MarkerVisual): void {
  // Geometry is module-shared; each marker owns only its materials.
  visual.ring.material.dispose();
  visual.fill.material.dispose();
  visual.sigilRing.material.dispose();
  visual.sigilBlade.material.dispose();
  visual.group.removeFromParent();
}

export class NythraxisSoulRendMarkers {
  private readonly visuals = new Map<number, MarkerVisual>();
  private readonly marked: NythraxisSoulRendEntityLike[] = [];
  private readonly seen = new Set<number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  /** One marker per marked raider: follows the raider, recolours by who is inside the ring. */
  syncWorld(world: { entities: ReadonlyMap<number, NythraxisSoulRendEntityLike> }): void {
    const marked = nythraxisSoulRendMarkedInto(this.marked, world.entities.values());
    if (marked.length === 0 && this.visuals.size === 0) return;
    this.seen.clear();
    for (let index = 0; index < marked.length; index++) {
      const entity = marked[index];
      const mark = nythraxisSoulRendMarkOf(entity);
      if (!mark) continue;
      this.seen.add(entity.id);
      let visual = this.visuals.get(entity.id);
      if (!visual) {
        const group = buildNythraxisSoulRendMarker();
        visual = {
          group,
          ring: group.userData.ring as MarkerVisual['ring'],
          fill: group.userData.fill as MarkerVisual['fill'],
          sigil: group.userData.sigil as THREE.Group,
          sigilRing: group.userData.sigilRing as MarkerVisual['sigilRing'],
          sigilBlade: group.userData.sigilBlade as MarkerVisual['sigilBlade'],
          palette: null,
          partners: 0,
          remaining: mark.remaining,
          duration: mark.duration,
          phase: (entity.id % 7) * 0.3,
        };
        group.userData.entityId = entity.id;
        this.scene.add(group);
        this.visuals.set(entity.id, visual);
      }
      const scale = Math.max(0.01, entity.scale ?? 1);
      visual.group.position.set(
        entity.pos.x,
        this.groundY(entity.pos.x, entity.pos.z),
        entity.pos.z,
      );
      // The sigil rides the raider's height; the ring stays the world-unit stack range.
      visual.sigil.position.y = NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT * scale;
      visual.sigil.scale.setScalar(scale);
      visual.partners = nythraxisSoulRendPartners(marked, index);
      visual.remaining = mark.remaining;
      visual.duration = mark.duration;
      visual.group.userData.partners = visual.partners;
      applyPalette(visual, nythraxisSoulRendPalette(visual.partners));
    }
    for (const [id, visual] of this.visuals) {
      if (this.seen.has(id)) continue;
      disposeVisual(visual);
      this.visuals.delete(id);
    }
  }

  update(dt: number, reducedMotion = false): void {
    const step = Math.max(0, dt);
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.phase += step;
      const pulse = nythraxisSoulRendPulse(
        visual.phase,
        visual.remaining,
        visual.duration,
        reducedMotion,
      );
      // The ring never drops below a readable floor: its position is gameplay.
      visual.ring.material.opacity = RING_OPACITY - 0.12 + pulse * 0.12;
      visual.fill.material.opacity = FILL_OPACITY + pulse * 0.08;
      visual.sigilRing.material.opacity = SIGIL_OPACITY - 0.2 + pulse * 0.2;
      visual.sigilBlade.material.opacity = SIGIL_OPACITY - 0.2 + pulse * 0.2;
      const scale = visual.sigil.scale.x;
      const bob = reducedMotion
        ? 0
        : Math.sin(visual.phase * Math.PI * 2) * NYTHRAXIS_SOUL_REND_SIGIL_BOB;
      visual.sigil.position.y = (NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT + bob) * scale;
      if (!reducedMotion) {
        visual.sigilRing.rotation.z = visual.phase * SIGIL_SPIN;
        visual.sigilBlade.rotation.y = visual.phase * SIGIL_SPIN * 1.6;
      }
    }
  }

  get count(): number {
    return this.visuals.size;
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
  }
}

/** A marker at the origin for the crypt prewarm, so its programs link before the first mark. */
export function buildNythraxisSoulRendMarkerPrewarmVisual(): THREE.Group {
  return buildNythraxisSoulRendMarker();
}
