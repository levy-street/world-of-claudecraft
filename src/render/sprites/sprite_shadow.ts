import * as THREE from 'three';
import { terrainHeight } from '../../sim/world';

// ---------------------------------------------------------------------------
// Sprite shadow blob — small dark ellipse on the ground beneath each sprite
// to anchor them visually in the 3D world.  Procedural radial-gradient
// texture (no image files), single shared geometry + material.
// ---------------------------------------------------------------------------

const SHADOW_SEGMENTS = 12;
const SHADOW_BASE_SIZE = 0.6; // half-size at height 1.0
const SHADOW_OPACITY = 0.35;
const SLOPE_FADE_THRESHOLD = 0.85; // dot(groundNormal, up) — steep slopes fade shadow

// Shared geometry: unit circle, scaled per-entity
let _geo: THREE.CircleGeometry | null = null;
function getGeo(): THREE.CircleGeometry {
  _geo ??= new THREE.CircleGeometry(1, SHADOW_SEGMENTS);
  return _geo;
}

// Procedural radial-gradient texture: dark center → transparent edge
let _tex: THREE.CanvasTexture | null = null;
function getTex(): THREE.CanvasTexture {
  if (_tex) return _tex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, `rgba(0,0,0,${SHADOW_OPACITY})`);
  grad.addColorStop(0.55, `rgba(0,0,0,${SHADOW_OPACITY * 0.45})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _tex = new THREE.CanvasTexture(canvas);
  _tex.needsUpdate = true;
  return _tex;
}

// Template material — each shadow gets its own clone so per-entity
// opacity/color writes don't overwrite other shadows.
let _matTemplate: THREE.MeshBasicMaterial | null = null;
function getMatTemplate(): THREE.MeshBasicMaterial {
  _matTemplate ??= new THREE.MeshBasicMaterial({
    map: getTex(),
    transparent: true,
    depthWrite: false,
    colorWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  return _matTemplate;
}

// Up vector for slope detection
const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Per-entity shadow state
// ---------------------------------------------------------------------------

export interface SpriteShadow {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  visible: boolean;
}

const _worldPos = new THREE.Vector3();

/**
 * Create a shadow blob for a sprite.  The mesh is a child of `parent` (the
 * sprite root) and sits at y ≈ 0 (ground level).
 */
export function createSpriteShadow(parent: THREE.Object3D): SpriteShadow {
  const material = getMatTemplate().clone();
  const mesh = new THREE.Mesh(getGeo(), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02; // tiny lift to avoid z-fight with terrain
  mesh.renderOrder = -1; // draw before sprite
  parent.add(mesh);
  return { mesh, material, visible: false };
}

/**
 * Update shadow position, scale and opacity for one sprite.
 *
 * @param shadow   — the `SpriteShadow` from `createSpriteShadow`
 * @param parent   — the sprite root (`visual.root`)
 * @param height   — the sprite's unscaled world height
 * @param scale    — `e.scale`
 * @param camY     — camera world Y (for top-down angle fade)
 * @param alive    — false when entity is dead/hidden
 * @param isOutdoor — false when entity is indoors (shadow hidden)
 * @param seed     — terrain seed for height sampling
 * @param fogColor — current fog color (for shadow tinting)
 */
export function updateSpriteShadow(
  shadow: SpriteShadow,
  parent: THREE.Object3D,
  height: number,
  scale: number,
  camY: number,
  alive: boolean,
  isOutdoor: boolean,
  seed: number,
  fogColor: THREE.Color,
): void {
  if (!alive || !isOutdoor) {
    if (shadow.visible) {
      shadow.mesh.visible = false;
      shadow.visible = false;
    }
    return;
  }

  // World position of the sprite root
  parent.getWorldPosition(_worldPos);
  const wx = _worldPos.x;
  const wz = _worldPos.z;

  // Terrain normal approximation via finite-difference height sampling
  const hL = terrainHeight(wx - 0.3, wz, seed);
  const hR = terrainHeight(wx + 0.3, wz, seed);
  const hD = terrainHeight(wx, wz - 0.3, seed);
  const hU = terrainHeight(wx, wz + 0.3, seed);
  _normal.set(hL - hR, 0.6, hD - hU).normalize();
  const slopeDot = _normal.dot(UP);

  // Steep slopes → fade out shadow entirely
  if (slopeDot < SLOPE_FADE_THRESHOLD) {
    if (shadow.visible) {
      shadow.mesh.visible = false;
      shadow.visible = false;
    }
    return;
  }

  // Scale: wider than tall (squashed circle) proportional to entity size
  const s = height * scale * SHADOW_BASE_SIZE;
  shadow.mesh.scale.set(s * 1.1, s * 0.7, 1);

  // Position at terrain height
  const groundY = terrainHeight(wx, wz, seed);
  shadow.mesh.position.y = 0.02 + groundY - _worldPos.y;

  // Opacity: fade with camera distance (top-down cameras → smaller shadow)
  const slopeFade = (slopeDot - SLOPE_FADE_THRESHOLD) / (1 - SLOPE_FADE_THRESHOLD);
  const camFactor = THREE.MathUtils.clamp(1 - Math.abs(camY - groundY) * 0.05, 0.4, 1);
  shadow.material.opacity = slopeFade * camFactor;

  // Tint shadow with fog color for environment blending
  shadow.material.color.copy(fogColor);

  shadow.mesh.visible = true;
  shadow.visible = true;
}

/**
 * Destroy a shadow blob.
 */
export function disposeSpriteShadow(shadow: SpriteShadow, parent: THREE.Object3D): void {
  parent.remove(shadow.mesh);
  shadow.material.dispose();
}
