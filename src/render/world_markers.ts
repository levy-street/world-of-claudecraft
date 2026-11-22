// The raid's world markers drawn on the floor (the Three half; every decision
// is in world_markers_core.ts). One pooled slot per symbol, all built up front
// at renderer construction and parked hidden in the scene; their programs and
// textures are warmed by the `vfx.world-markers` prewarm manifest entry
// (worldMarkerPrewarmEntry below: a staged visible twin of every piece, since
// a compile walks only visible objects), so the first mark a raid leader drops
// links nothing and uploads nothing in a live frame.
//
// Each mark reads as a flare, a beacon of its colour seen from across a room:
// a glowing circle draped over the floor (fill, rim, keyline, inner ring and a
// turning rune band, all procedural in one shader), an additive pool of light
// on the same drape, a soft beam of light rising from the circle (brightest at
// the floor, fading upward, wavering like a lit flare, with motes of light
// rising inside it), and the marker's own symbol (the target-marker sprite)
// floating well over a tall character's head on a soft additive glow,
// billboarded and held inside a screen-size band so it reads from across a
// room and from a low camera without ballooning up close. No lights, no
// per-frame allocation: a frame with no marks returns after one fold, a frame
// with marks writes a few uniforms and sprite transforms.
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
  createWorldMarkerSymbolPose,
  syncWorldMarkerSlots,
  WORLD_MARKER_BEAM_HEIGHT,
  WORLD_MARKER_BEAM_PHASE,
  WORLD_MARKER_BEAM_RADIUS_BOTTOM,
  WORLD_MARKER_BEAM_RADIUS_TOP,
  WORLD_MARKER_CAMERA_FOV,
  WORLD_MARKER_COLORS,
  WORLD_MARKER_COUNT,
  WORLD_MARKER_RADIUS,
  WORLD_MARKER_SYMBOL_GLOW_OPACITY,
  WORLD_MARKER_VERTS,
  WorldMarkerChange,
  type WorldMarkerFloor,
  type WorldMarkerLook,
  type WorldMarkerMark,
  worldMarkerClock,
  worldMarkerDiscIndex,
  worldMarkerFlare,
  worldMarkerLook,
  worldMarkerPulse,
  worldMarkerSymbolPoseInto,
  writeWorldMarkerDrape,
} from './world_markers_core';

const DISC_VERTEX = `
  uniform float uRadius;
  varying vec2 vLocal;
  void main() {
    vLocal = position.xz / uRadius;
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

// The floor light pool on the circle's own drape: an additive bowl of the
// marker's light, hottest at the centre with a lift along the rim, so the
// floor under a flare looks lit. Wavers with the flare.
const POOL_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uFlare;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    if (r > 1.32) discard;
    float core = pow(max(1.0 - smoothstep(0.0, 1.3, r), 0.0), 1.35);
    float d = (r - 0.95) / 0.13;
    float rim = exp(-d * d);
    float a = (core * 0.42 + rim * 0.18) * uFlare;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.12), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const BEAM_VERTEX = `
  varying vec2 vUv;
  varying float vFacing;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

// The beacon's beam: an open cylinder of the marker's light, both faces
// additive, so it reads as a volume (thicker through the middle, fading to
// nothing at the silhouette, so no hard tube edge). Brightest at the floor
// and fading upward, with slow vertical streaks, a band of light running up
// it and (where the tier keeps them) motes of light rising inside. It fades
// out close to the camera, so a camera pulled into a beam is not filled with
// its colour. uTime is the layer's shared clock (held at 0 under reduced
// motion), uPhase spreads the eight beams apart, uFlare is the flicker times
// the tier's beam strength.
const BEAM_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uFlare;
  uniform float uTime;
  uniform float uPhase;
  uniform float uMotes;
  uniform float uHeight;
  varying vec2 vUv;
  varying float vFacing;
  varying float vDepth;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    // A camera standing in the beam never sees a wall of colour, and pays
    // for no shading there: the fade decides first.
    float near = uFlare * smoothstep(1.5, 4.5, vDepth);
    if (near < 0.003) discard;
    float h = vUv.y;
    // Rises out of the floor pool (no hard ring where it meets the floor).
    float fall = pow(max(1.0 - h, 0.0), 1.7) * (0.55 + 0.45 * smoothstep(0.0, 0.06, h));
    float body = pow(max(vFacing, 0.0), 1.6);
    float ang = vUv.x * 6.2831853;
    float s = 0.5 + 0.5 * sin(ang * 7.0 + sin(h * 4.0 - uTime * 0.9 + uPhase) * 1.7);
    float streak = 0.72 + 0.56 * s * s * s;
    float run = 0.86 + 0.14 * sin(h * 9.0 - uTime * 2.4 + uPhase);
    float a = fall * body * streak * run * 0.46;
    // Motes: a sparse grid in yards round the beam, scrolling up (a tier
    // without them skips the whole block).
    if (uMotes > 0.5) {
      vec2 cs = vec2(0.62, 0.95);
      vec2 p = vec2(vUv.x * 7.0, h * uHeight - uTime * 0.7 - uPhase);
      vec2 cell = floor(p / cs);
      vec2 f = p - cell * cs;
      vec2 c = cs * (0.25 + 0.5 * vec2(hash(cell), hash(cell + 3.7)));
      float dm = length(f - c);
      float twinkle = 0.6 + 0.4 * sin(uTime * 5.0 + hash(cell + 9.1) * 40.0);
      float mote = (1.0 - smoothstep(0.025, 0.075, dm)) * step(0.55, hash(cell + 1.3));
      a += mote * twinkle * (1.0 - h) * 0.9;
    }
    a *= near;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), fall * 0.1), min(a, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The symbol's sprite canvas (px) and the art's share of it (1:1 with the
 *  target-marker sprite's 128 px canvas; the rest is the drop shadow's room). */
const SYMBOL_PX = 160;
const SYMBOL_ART = 0.8;
const GLOW_PX = 128;
const BEAM_SEGMENTS = 40;
const RUNE_SPIN_PER_S = 0.32;
/** The floating glow and symbol's order: the pool's rung, over the disc and
 *  beam (a floor telegraph still paints over them, as it does the circle). */
const SYMBOL_ORDER = floorVfxRenderOrder('ground', 7);

interface MarkerPiece {
  disc: THREE.Mesh;
  discMat: THREE.ShaderMaterial;
  positions: THREE.BufferAttribute;
  pool: THREE.Mesh;
  poolMat: THREE.ShaderMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  sprite: THREE.Sprite;
  spriteMat: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
}

export interface WorldMarkerLayerOptions {
  /** The floor height at (x, z) for a body near refY (the sim's floor query). */
  floor: WorldMarkerFloor;
  /** The static preset is the low tier (sheds the motes, runes and fill, and
   *  halves the beam and pool). */
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

/** The symbol's sprite art: the target-marker symbol over a soft dark drop
 *  shadow, so a pale symbol still reads against its own bright beam. Built
 *  once per symbol per layer; the same art on every tier. */
function symbolCanvas(symbol: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SYMBOL_PX;
  canvas.height = SYMBOL_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const art = SYMBOL_PX * SYMBOL_ART;
  const at = (SYMBOL_PX - art) / 2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = SYMBOL_PX * 0.05;
  ctx.shadowOffsetY = SYMBOL_PX * 0.012;
  ctx.drawImage(raidMarkerSprite(symbol), at, at, art, art);
  return canvas;
}

/** The soft white glow the eight symbol glows share (tinted per material). */
function glowCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_PX;
  canvas.height = GLOW_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const mid = GLOW_PX / 2;
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(0.22, 'rgba(255, 255, 255, 0.6)');
  g.addColorStop(0.55, 'rgba(255, 255, 255, 0.16)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_PX, GLOW_PX);
  return canvas;
}

/** The beam: an open, slightly tapered cylinder, its base on the floor
 *  (uv.y 0) and its top at the beam's height (uv.y 1). */
function beamGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    WORLD_MARKER_BEAM_RADIUS_TOP,
    WORLD_MARKER_BEAM_RADIUS_BOTTOM,
    WORLD_MARKER_BEAM_HEIGHT,
    BEAM_SEGMENTS,
    1,
    true,
  );
  geometry.translate(0, WORLD_MARKER_BEAM_HEIGHT / 2, 0);
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
  private readonly beamGeo: THREE.BufferGeometry;
  private readonly glowTexture: THREE.CanvasTexture;
  /** One clock every beam reads (written once per frame). */
  private readonly beamTime = { value: 0 };
  /** The one pose every symbol is written through each frame. */
  private readonly pose = createWorldMarkerSymbolPose();
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
    this.beamGeo = beamGeometry();
    this.glowTexture = new THREE.CanvasTexture(glowCanvas());
    this.glowTexture.colorSpace = THREE.SRGBColorSpace;
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

    // The pool shares the disc's drape, one rung over it, on its own mesh at the mark.
    const poolMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX,
      fragmentShader: POOL_FRAGMENT,
      uniforms: {
        uRadius: { value: WORLD_MARKER_RADIUS },
        uColor: { value: color },
        uFlare: { value: 1 },
      },
      transparent: true,
      forceSinglePass: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const pool = new THREE.Mesh(geometry, poolMat);
    pool.name = `world-marker-pool-${symbol}`;
    pool.renderOrder = floorVfxRenderOrder('ground', 7);
    pool.visible = false;
    this.group.add(pool);

    const beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: {
        uColor: { value: color },
        uFlare: { value: 1 },
        uTime: this.beamTime,
        uPhase: { value: symbol * WORLD_MARKER_BEAM_PHASE },
        uMotes: { value: this.look.motes ? 1 : 0 },
        uHeight: { value: WORLD_MARKER_BEAM_HEIGHT },
      },
      transparent: true,
      forceSinglePass: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(this.beamGeo, beamMat);
    beam.name = `world-marker-beam-${symbol}`;
    // Under the circle: the disc and pool lay over the beam's foot the same
    // way from every camera (an unordered beam would depth-sort against them).
    beam.renderOrder = floorVfxRenderOrder('ground', 5);
    beam.visible = false;
    this.group.add(beam);

    // The glow and the symbol ride the pool's rung, over the disc and the
    // beam, so neither the circle nor the beam ever paints over the symbol.
    // The glow is built BEFORE the symbol: the two share a position and an
    // order (so the transparent sort ties) and three breaks the tie by id, so
    // the glow always lays its light first and the symbol paints over it crisp.
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: WORLD_MARKER_SYMBOL_GLOW_OPACITY,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.name = `world-marker-glow-${symbol}`;
    glow.renderOrder = SYMBOL_ORDER;
    glow.visible = false;
    this.group.add(glow);

    const texture = new THREE.CanvasTexture(symbolCanvas(symbol));
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.name = `world-marker-symbol-${symbol}`;
    sprite.renderOrder = SYMBOL_ORDER;
    sprite.visible = false;
    this.group.add(sprite);
    return {
      disc,
      discMat,
      positions,
      pool,
      poolMat,
      beam,
      beamMat,
      glow,
      glowMat,
      sprite,
      spriteMat,
      texture,
    };
  }

  /** The layer released its resources (a prewarm unit draining late does nothing). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Every mark currently drawn (tests and the perf probe read it). */
  get shown(): number {
    return this.shownCount;
  }

  /**
   * One frame: fold the live marks into the slots (a placed, moved or cleared
   * mark re-drapes or hides its slot), then breathe the circle, flicker the
   * flare and keep each symbol at a readable size and height for `camera`.
   * `time` is the renderer clock.
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
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
      ? (camera as THREE.PerspectiveCamera).fov
      : WORLD_MARKER_CAMERA_FOV;
    const clock = worldMarkerClock(time, reducedMotion);
    const spin = clock * RUNE_SPIN_PER_S;
    this.beamTime.value = clock;
    const pose = this.pose;
    for (let s = 0; s < WORLD_MARKER_COUNT; s++) {
      const slot = this.slots[s];
      if (!slot.shown) continue;
      const piece = this.pieces[s];
      piece.discMat.uniforms.uPulse.value = worldMarkerPulse(time, s, reducedMotion);
      piece.discMat.uniforms.uSpin.value = spin;
      const light = worldMarkerFlare(time, s, reducedMotion) * this.look.beam;
      piece.poolMat.uniforms.uFlare.value = light;
      piece.beamMat.uniforms.uFlare.value = light;
      worldMarkerSymbolPoseInto(pose, cam.x, cam.y, cam.z, fov, slot, time, s, reducedMotion);
      piece.glowMat.opacity = pose.glowOpacity;
      piece.sprite.position.set(slot.x, pose.y, slot.z);
      piece.sprite.scale.set(pose.size, pose.size, 1);
      piece.glow.position.set(slot.x, pose.y, slot.z);
      piece.glow.scale.set(pose.glowSize, pose.glowSize, 1);
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
        // The drape is relative to the mark: the mesh stands on it (the pool
        // rides the same mesh's geometry, so it moves with its own mesh).
        piece.disc.position.set(slot.x, slot.y, slot.z);
        piece.pool.position.set(slot.x, slot.y, slot.z);
        piece.beam.position.set(slot.x, slot.y, slot.z);
      }
      piece.disc.visible = slot.shown;
      piece.pool.visible = slot.shown;
      piece.beam.visible = slot.shown;
      piece.glow.visible = slot.shown;
      piece.sprite.visible = slot.shown;
      if (slot.shown) shown++;
    }
    this.shownCount = shown;
  }

  /** Every texture the layer draws with: the eight symbols and the shared
   *  glow (the prewarm entry uploads them under the curtain). */
  prewarmTextures(): THREE.Texture[] {
    if (this.disposed) return [];
    const textures: THREE.Texture[] = this.pieces.map((p) => p.texture);
    textures.push(this.glowTexture);
    return textures;
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
      root.add(new THREE.Mesh(p.pool.geometry, p.poolMat));
      root.add(new THREE.Mesh(p.beam.geometry, p.beamMat));
      root.add(new THREE.Sprite(p.glowMat));
      root.add(new THREE.Sprite(p.spriteMat));
    }
    this.stagedRoot = root;
    return root;
  }

  /** Release every GPU resource; one failing release never strands the rest. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stagedRoot = null;
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
      // The index attribute is shared by all eight discs, and each pool rides
      // its disc's geometry; a repeat dispose is a no-op.
      tryRelease(() => p.disc.geometry.dispose());
      tryRelease(() => p.discMat.dispose());
      tryRelease(() => p.poolMat.dispose());
      tryRelease(() => p.beamMat.dispose());
      tryRelease(() => p.glowMat.dispose());
      tryRelease(() => p.spriteMat.dispose());
      tryRelease(() => p.texture.dispose());
    }
    tryRelease(() => this.beamGeo.dispose());
    tryRelease(() => this.glowTexture.dispose());
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
 * the eight symbol textures and the shared glow, and link the disc, pool,
 * beam and sprite programs through the staged twin, behind the loading
 * curtain. A dropped entry resumes its textures as cosmetic units and its
 * programs as debt (`programs.<id>`), so the first mark dropped mid-raid
 * never links in a live frame.
 */
export function worldMarkerPrewarmEntry(layer: WorldMarkerLayer, host: WorldMarkerPrewarmHost) {
  const link = async () => {
    if (!layer.isDisposed) await host.compileColor(layer.prewarmRoot());
  };
  return {
    id: 'vfx.world-markers',
    category: 'vfx' as const,
    priority: 62,
    required: false,
    resumeUnits: () =>
      layer.prewarmTextures().map((texture, i) => ({
        id: `texture:world-marker-${i}`,
        synchronous: true,
        run: () => {
          if (!layer.isDisposed) host.prewarmTexture(texture);
        },
      })),
    resumeProgramUnits: () => [{ id: 'link:world-markers', run: link }],
    run: async () => {
      for (const texture of layer.prewarmTextures()) host.prewarmTexture(texture);
      await link();
    },
  };
}
