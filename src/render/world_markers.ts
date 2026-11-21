// The raid's world markers drawn on the floor (the Three half; every decision
// is in world_markers_core.ts). One pooled slot per symbol, all built up front
// at renderer construction and parked hidden in the scene; their programs and
// symbol textures are warmed by the `vfx.world-markers` prewarm manifest entry
// (worldMarkerPrewarmEntry below: a staged visible twin of every piece, since
// a compile walks only visible objects), so the first mark a raid leader drops
// links nothing and uploads nothing in a live frame: a glowing circle
// draped over the floor in the marker's colour (fill, rim, keyline, inner
// ring and a turning rune band, all procedural in one shader), a soft light
// column, and the marker's own symbol (the target-marker sprite) floating
// over it, billboarded and scaled with distance so it reads from across a
// room and from a low camera. No lights, no per-frame allocation: a frame
// with no marks returns after one fold, a frame with marks writes a few
// uniforms and sprite transforms.
//
// Reads IWorld.sharedMapMarks only (presentation; the sim owns the marks).

import * as THREE from 'three';
import { floorHeightAt } from '../sim/physics';
import { SHARED_MAP_MARK_STEP_REACH } from '../sim/social/shared_map_marks';
import { raidMarkerSprite } from '../ui/icons';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { setRenderCategory } from './renderer_diagnostics';
import {
  createWorldMarkerSlots,
  syncWorldMarkerSlots,
  WORLD_MARKER_COLORS,
  WORLD_MARKER_COUNT,
  WORLD_MARKER_RADIUS,
  WORLD_MARKER_VERTS,
  WorldMarkerChange,
  type WorldMarkerFloor,
  type WorldMarkerLook,
  type WorldMarkerMark,
  worldMarkerCss,
  worldMarkerDiscIndex,
  worldMarkerLook,
  worldMarkerPulse,
  worldMarkerSymbolLift,
  worldMarkerSymbolSize,
  writeWorldMarkerDrape,
} from './world_markers_core';

const DISC_VERTEX = `
  uniform vec2 uCenter;
  uniform float uRadius;
  varying vec2 vLocal;
  void main() {
    vLocal = (position.xz - uCenter) / uRadius;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The circle in rim units (r = 1 is the rim): a dark keyline either side of a
// hot rim (it reads on a pale floor AND a dark one), a soft bowl of light
// inside, an inner ring, a band of turning rune dashes and a halo past the
// rim. uGlow and uRunes are the tier's (0 sheds them); the rim, its keylines
// and the inner ring always draw.
const DISC_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uPulse;
  uniform float uSpin;
  uniform float uGlow;
  uniform float uRunes;
  uniform float uBoost;
  varying vec2 vLocal;
  float band(float r, float a, float b, float soft) {
    return smoothstep(a - soft, a, r) * (1.0 - smoothstep(b, b + soft, r));
  }
  void main() {
    float r = length(vLocal);
    if (r > 1.32) discard;
    float rim = band(r, 0.9, 1.0, 0.025);
    float rimCore = band(r, 0.93, 0.975, 0.02);
    float keyOut = band(r, 1.0, 1.055, 0.02);
    float keyIn = band(r, 0.845, 0.885, 0.018);
    float inner = band(r, 0.585, 0.615, 0.018);
    float fill = (0.12 + 0.2 * smoothstep(0.15, 0.85, r)) * (1.0 - smoothstep(0.84, 0.86, r));
    float halo = step(1.055, r) * (1.0 - smoothstep(1.06, 1.32, r)) * 0.42;
    float a = atan(vLocal.y, vLocal.x) + uSpin;
    float seg = fract(a * 2.5464791);
    float dash = smoothstep(0.06, 0.12, seg) * (1.0 - smoothstep(0.5, 0.56, seg));
    float runes = band(r, 0.68, 0.79, 0.012) * dash * 0.7;
    float light = max(max(rim, inner * 0.85), max(fill * uGlow, max(runes * uRunes, halo * uGlow)));
    vec3 hot = mix(uColor, vec3(1.0), rimCore * 0.4) * uBoost;
    float dark = max(keyOut, keyIn) * 0.6;
    float alpha = light + dark * (1.0 - light);
    if (alpha < 0.004) discard;
    vec3 rgb = (hot * light + vec3(0.012) * dark * (1.0 - light)) / alpha;
    gl_FragColor = vec4(rgb, alpha * uPulse);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const COLUMN_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A soft shaft of the marker's light from the floor to the symbol: brightest
// at the floor, fading up and to both edges. Additive, so it only brightens.
const COLUMN_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uPulse;
  varying vec2 vUv;
  void main() {
    float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float a = pow(edge, 2.2) * pow(1.0 - vUv.y, 1.7) * 0.55 * uPulse;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const COLUMN_WIDTH = 0.62;
const COLUMN_HEIGHT = 2.05;
const SYMBOL_PX = 192;
const RUNE_SPIN_PER_S = 0.32;

interface MarkerPiece {
  disc: THREE.Mesh;
  discMat: THREE.ShaderMaterial;
  positions: THREE.BufferAttribute;
  column: THREE.Mesh | null;
  columnMat: THREE.ShaderMaterial | null;
  sprite: THREE.Sprite;
  spriteMat: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
}

export interface WorldMarkerLayerOptions {
  /** The floor height at (x, z) for a body near refY (the sim's floor query). */
  floor: WorldMarkerFloor;
  /** The static preset is the low tier (sheds the glow, column and runes). */
  lowTier: boolean;
  /** The bloom-edge colour boost the selection rings use (1 on low). */
  boost: number;
}

/** The drape's floor: the sim's own movement floor under a body near refY
 *  (the same query that resolved the mark's height), so the circle lies on
 *  exactly the surfaces a player stands on. */
export function worldMarkerSimFloor(seed: () => number): WorldMarkerFloor {
  return (x, z, refY) => floorHeightAt(seed(), x, z, 0, refY + SHARED_MAP_MARK_STEP_REACH);
}

/** The symbol's sprite art: the target-marker symbol, over a soft halo of its
 *  colour where the tier keeps the glow. Built once per symbol per layer. */
function symbolCanvas(symbol: number, look: WorldMarkerLook): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SYMBOL_PX;
  canvas.height = SYMBOL_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const mid = SYMBOL_PX / 2;
  if (look.column) {
    const halo = ctx.createRadialGradient(mid, mid, SYMBOL_PX * 0.12, mid, mid, mid);
    halo.addColorStop(0, worldMarkerCss(symbol, 0.55));
    halo.addColorStop(0.55, worldMarkerCss(symbol, 0.18));
    halo.addColorStop(1, worldMarkerCss(symbol, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, SYMBOL_PX, SYMBOL_PX);
  }
  const art = SYMBOL_PX * 0.66;
  ctx.drawImage(raidMarkerSprite(symbol), mid - art / 2, mid - art / 2, art, art);
  return canvas;
}

/** Two crossed vertical quads, base on the floor (uv.y 0) and top at the symbol. */
function columnGeometry(): THREE.BufferGeometry {
  const w = COLUMN_WIDTH / 2;
  const h = COLUMN_HEIGHT;
  const geometry = new THREE.BufferGeometry();
  // prettier-ignore
  const pos = new Float32Array([
    -w,
    0,
    0,
    w,
    0,
    0,
    w,
    h,
    0,
    -w,
    h,
    0,
    0,
    0,
    -w,
    0,
    0,
    w,
    0,
    h,
    w,
    0,
    h,
    -w,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeBoundingSphere();
  return geometry;
}

export class WorldMarkerLayer {
  readonly group = new THREE.Group();
  private readonly slots = createWorldMarkerSlots();
  private readonly changes: WorldMarkerChange[] = new Array(WORLD_MARKER_COUNT).fill(
    WorldMarkerChange.None,
  );
  private readonly pieces: MarkerPiece[] = [];
  private readonly index: THREE.BufferAttribute;
  private readonly columnGeo: THREE.BufferGeometry | null;
  private readonly look: WorldMarkerLook;
  private shownCount = 0;
  private disposed = false;
  private stagedRoot: THREE.Group | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly opts: WorldMarkerLayerOptions,
  ) {
    this.group.name = 'world-markers';
    this.look = worldMarkerLook(opts.lowTier);
    this.index = new THREE.BufferAttribute(worldMarkerDiscIndex(), 1);
    this.columnGeo = this.look.column ? columnGeometry() : null;
    for (let s = 0; s < WORLD_MARKER_COUNT; s++) this.pieces.push(this.buildPiece(s));
    setRenderCategory(this.group, 'ui3d');
    this.scene.add(this.group);
  }

  private buildPiece(symbol: number): MarkerPiece {
    const color = new THREE.Color(WORLD_MARKER_COLORS[symbol]);
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(WORLD_MARKER_VERTS * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    geometry.setIndex(this.index);
    const discMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX,
      fragmentShader: DISC_FRAGMENT,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: WORLD_MARKER_RADIUS },
        uColor: { value: color },
        uPulse: { value: 1 },
        uSpin: { value: 0 },
        uGlow: { value: this.look.glow ? 1 : 0 },
        uRunes: { value: this.look.runes ? 1 : 0 },
        uBoost: { value: this.opts.boost },
      },
      transparent: true,
      // One pass: a floor disc needs no back-to-front self sort.
      forceSinglePass: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(geometry, discMat);
    disc.name = `world-marker-disc-${symbol}`;
    disc.renderOrder = floorVfxRenderOrder('ground', 6);
    disc.visible = false;
    this.group.add(disc);

    let column: THREE.Mesh | null = null;
    let columnMat: THREE.ShaderMaterial | null = null;
    if (this.columnGeo) {
      columnMat = new THREE.ShaderMaterial({
        vertexShader: COLUMN_VERTEX,
        fragmentShader: COLUMN_FRAGMENT,
        uniforms: { uColor: { value: color }, uPulse: { value: 1 } },
        transparent: true,
        forceSinglePass: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      column = new THREE.Mesh(this.columnGeo, columnMat);
      column.name = `world-marker-column-${symbol}`;
      column.visible = false;
      this.group.add(column);
    }

    const texture = new THREE.CanvasTexture(symbolCanvas(symbol, this.look));
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.name = `world-marker-symbol-${symbol}`;
    sprite.visible = false;
    this.group.add(sprite);
    return {
      disc,
      discMat,
      positions,
      column,
      columnMat,
      sprite,
      spriteMat,
      texture,
    };
  }

  /** Every mark currently drawn (tests and the perf probe read it). */
  get shown(): number {
    return this.shownCount;
  }

  /**
   * One frame: fold the live marks into the slots (a placed, moved or cleared
   * mark re-drapes or hides its slot), then breathe the light and keep each
   * symbol at a readable size for `camera`. `time` is the renderer clock.
   */
  update(
    marks: readonly WorldMarkerMark[],
    camera: THREE.Camera,
    time: number,
    reducedMotion: boolean,
  ): void {
    if (this.disposed) return;
    if (syncWorldMarkerSlots(this.slots, marks, this.changes)) this.apply();
    if (this.shownCount === 0) return;
    const cam = camera.position;
    const spin = reducedMotion ? 0 : time * RUNE_SPIN_PER_S;
    for (let s = 0; s < WORLD_MARKER_COUNT; s++) {
      const slot = this.slots[s];
      if (!slot.shown) continue;
      const piece = this.pieces[s];
      const pulse = worldMarkerPulse(time, s, reducedMotion);
      piece.discMat.uniforms.uPulse.value = pulse;
      piece.discMat.uniforms.uSpin.value = spin;
      if (piece.columnMat) piece.columnMat.uniforms.uPulse.value = pulse;
      const y = slot.y + worldMarkerSymbolLift(time, s, reducedMotion);
      piece.sprite.position.set(slot.x, y, slot.z);
      const dx = cam.x - slot.x;
      const dy = cam.y - y;
      const dz = cam.z - slot.z;
      const size = worldMarkerSymbolSize(Math.sqrt(dx * dx + dy * dy + dz * dz));
      piece.sprite.scale.set(size, size, 1);
    }
  }

  private apply(): void {
    let shown = 0;
    for (let s = 0; s < WORLD_MARKER_COUNT; s++) {
      const slot = this.slots[s];
      const piece = this.pieces[s];
      const change = this.changes[s];
      if (change === WorldMarkerChange.Show || change === WorldMarkerChange.Move) {
        writeWorldMarkerDrape(
          piece.positions.array as Float32Array,
          slot.x,
          slot.y,
          slot.z,
          this.opts.floor,
        );
        piece.positions.needsUpdate = true;
        piece.disc.geometry.computeBoundingSphere();
        (piece.discMat.uniforms.uCenter.value as THREE.Vector2).set(slot.x, slot.z);
        piece.column?.position.set(slot.x, slot.y, slot.z);
      }
      piece.disc.visible = slot.shown;
      if (piece.column) piece.column.visible = slot.shown;
      piece.sprite.visible = slot.shown;
      if (slot.shown) shown++;
    }
    this.shownCount = shown;
  }

  /** Every symbol texture (the prewarm entry uploads them under the curtain). */
  prewarmTextures(): THREE.Texture[] {
    return this.pieces.map((p) => p.texture);
  }

  /** A staged, VISIBLE twin of every piece (same geometry, same materials), off
   *  the scene: a compile walks only visible objects, and the live slots stay
   *  hidden until a mark exists. Built once. */
  prewarmRoot(): THREE.Group {
    if (this.stagedRoot) return this.stagedRoot;
    const root = new THREE.Group();
    root.name = 'world-markers-prewarm';
    for (const p of this.pieces) {
      root.add(new THREE.Mesh(p.disc.geometry, p.discMat));
      if (p.column && p.columnMat) root.add(new THREE.Mesh(p.column.geometry, p.columnMat));
      root.add(new THREE.Sprite(p.spriteMat));
    }
    this.stagedRoot = root;
    return root;
  }

  /** Release every GPU resource; one failing release never strands the rest. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    const tryRelease = (release: () => void): void => {
      try {
        release();
      } catch (err) {
        errors.push(err);
      }
    };
    tryRelease(() => this.scene.remove(this.group));
    for (const p of this.pieces) {
      // The index attribute is shared by all eight discs; a repeat dispose is a no-op.
      tryRelease(() => p.disc.geometry.dispose());
      tryRelease(() => p.discMat.dispose());
      tryRelease(() => p.columnMat?.dispose());
      tryRelease(() => p.spriteMat.dispose());
      tryRelease(() => p.texture.dispose());
    }
    tryRelease(() => this.columnGeo?.dispose());
    if (errors.length > 0) throw new AggregateError(errors, 'world markers dispose failed');
  }
}

/** What the prewarm entry needs from the renderer. */
export interface WorldMarkerPrewarmHost {
  prewarmTexture(texture: THREE.Texture): void;
  compileColor(root: THREE.Object3D): Promise<void>;
}

/**
 * The layer's world-entry prewarm manifest entry (`vfx.world-markers`): upload
 * the eight symbol textures and link the disc, column and sprite programs
 * through the staged twin, behind the loading curtain. A dropped entry resumes
 * its textures as cosmetic units and its programs as debt (`programs.<id>`),
 * so the first mark dropped mid-raid never links in a live frame.
 */
export function worldMarkerPrewarmEntry(layer: WorldMarkerLayer, host: WorldMarkerPrewarmHost) {
  const link = () => host.compileColor(layer.prewarmRoot());
  return {
    id: 'vfx.world-markers',
    category: 'vfx' as const,
    priority: 62,
    required: false,
    resumeUnits: () =>
      layer.prewarmTextures().map((texture, i) => ({
        id: `texture:world-marker-${i}`,
        synchronous: true,
        run: () => host.prewarmTexture(texture),
      })),
    resumeProgramUnits: () => [{ id: 'link:world-markers', run: link }],
    run: async () => {
      for (const texture of layer.prewarmTextures()) host.prewarmTexture(texture);
      await link();
    },
  };
}
