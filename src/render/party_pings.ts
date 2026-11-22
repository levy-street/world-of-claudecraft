// The party pings in the world (the Three half; every decision is in
// party_pings_core.ts). One pooled slot per live ping a group can hold, all
// built up front at renderer construction and parked hidden in the scene;
// their programs and textures are warmed by the `vfx.party-pings` prewarm
// manifest entry (partyPingPrewarmEntry below: a staged visible twin of
// every piece, since a compile walks only visible objects), so the first
// ping of a session links nothing and uploads nothing in a live frame.
//
// A ping reads as a callout, not a decoration: the ping's badge icon
// floating over its unit (following it) or over its ground point, held at a
// readable screen size at any distance and drawn over the world so a wall
// never hides it, popping in and fading at the end of its life; under it a
// ground ring in the ping's colour rippling outward, and (shed on the low
// preset, cosmetic only) a soft glow behind the badge and a thin light stem
// from the ground up to it. The icon and the ring always draw: what a player
// reacts to never depends on the graphics preset.
//
// Reads IWorld.partyPings only (presentation; the sim owns the pings), and
// draws nothing while the player has pings turned off (settings.partyPings).
// No lights, no per-frame allocation: a frame with no pings returns after one
// fold.

import * as THREE from 'three';
import { partyPingsEnabled } from '../game/party_pings_setting';
import { PING_KIND_COUNT } from '../sim/social/party_pings';
import { pingIconCanvas } from '../ui/ping_icons';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import {
  createPartyPingAnchor,
  createPartyPingSlots,
  PARTY_PING_CAMERA_FOV,
  PARTY_PING_COLORS,
  PARTY_PING_GROUND_LIFT,
  PARTY_PING_RING_RADIUS,
  PARTY_PING_SLOTS,
  type PartyPingMark,
  partyPingAlpha,
  partyPingAnchorInto,
  partyPingBob,
  partyPingIconSize,
  partyPingIconY,
  partyPingPop,
  partyPingRipple,
  syncPartyPingSlots,
} from './party_pings_core';
import { setRenderCategory } from './renderer_diagnostics';

const RING_VERTEX = `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The ground ring in rim units (r = 1 is the rim): a steady keylined rim, a
// soft inner bowl, and a ripple travelling outward from the centre (uPhase),
// all faded by uAlpha.
const RING_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uPhase;
  uniform float uAlpha;
  varying vec2 vLocal;
  float band(float r, float a, float b, float soft) {
    return smoothstep(a - soft, a, r) * (1.0 - smoothstep(b, b + soft, r));
  }
  void main() {
    float r = length(vLocal);
    if (r > 1.25) discard;
    float rim = band(r, 0.86, 0.97, 0.03);
    float key = band(r, 0.97, 1.04, 0.02) * 0.7;
    float bowl = (1.0 - smoothstep(0.0, 0.9, r)) * 0.22;
    float rp = uPhase * 1.1;
    float ripple = band(r, rp - 0.07, rp, 0.05) * (1.0 - uPhase);
    float halo = step(1.04, r) * (1.0 - smoothstep(1.04, 1.25, r)) * 0.35;
    float light = max(max(rim, ripple * 0.9), max(bowl, halo));
    float alpha = light + key * (1.0 - light);
    if (alpha < 0.004) discard;
    vec3 rgb = (mix(uColor, vec3(1.0), rim * 0.35) * light + vec3(0.02) * key * (1.0 - light)) / alpha;
    gl_FragColor = vec4(rgb, alpha * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STEM_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The light stem from the ground to the badge: brightest at the foot.
const STEM_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float a = (1.0 - vUv.y) * 0.55 + 0.1;
    gl_FragColor = vec4(uColor, a * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ICON_PX = 128;
const GLOW_PX = 128;
const STEM_RADIUS = 0.05;
/** Draw order: the ring on the floor band, the stem and glow over it, the
 *  badge over everything (it ignores depth, so a wall never hides it). */
const RING_ORDER = floorVfxRenderOrder('ground', 7);
const ICON_ORDER = 9_000;

/** The unit a ping is attached to, as this client draws it this frame. */
export interface PartyPingUnitView {
  group: THREE.Object3D;
  height: number;
}

interface PingPiece {
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  stem: THREE.Mesh;
  stemMat: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  icon: THREE.Sprite;
  iconMat: THREE.SpriteMaterial;
}

function glowCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_PX;
  canvas.height = GLOW_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const mid = GLOW_PX / 2;
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  g.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_PX, GLOW_PX);
  return canvas;
}

export class PartyPingLayer {
  readonly group = new THREE.Group();
  private readonly slots = createPartyPingSlots();
  private readonly pieces: PingPiece[] = [];
  private readonly icons: THREE.CanvasTexture[] = [];
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly ringGeo: THREE.PlaneGeometry;
  private readonly stemGeo: THREE.CylinderGeometry;
  private readonly colors: THREE.Color[];
  private readonly anchor = createPartyPingAnchor();
  private readonly unitAt = { x: 0, y: 0, z: 0, top: 0 };
  private shownCount = 0;
  private disposed = false;
  private stagedRoot: THREE.Group | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lowTier: boolean,
    private readonly unitView: (id: number) => PartyPingUnitView | undefined,
  ) {
    this.group.name = 'party-pings';
    this.colors = PARTY_PING_COLORS.map((c) => new THREE.Color(c));
    for (let k = 0; k < PING_KIND_COUNT; k++) {
      const texture = new THREE.CanvasTexture(pingIconCanvas(k, ICON_PX));
      texture.colorSpace = THREE.SRGBColorSpace;
      this.icons.push(texture);
    }
    this.glowTexture = new THREE.CanvasTexture(glowCanvas());
    this.glowTexture.colorSpace = THREE.SRGBColorSpace;
    // The ring's plane stays in its local xy (the shader's rim units); the
    // mesh lays it flat on the floor.
    this.ringGeo = new THREE.PlaneGeometry(2.5, 2.5);
    this.stemGeo = new THREE.CylinderGeometry(STEM_RADIUS, STEM_RADIUS, 1, 6, 1, true);
    this.stemGeo.translate(0, 0.5, 0);
    for (let s = 0; s < PARTY_PING_SLOTS; s++) this.pieces.push(this.buildPiece());
    setRenderCategory(this.group, 'ui3d');
    this.scene.add(this.group);
  }

  private buildPiece(): PingPiece {
    const color = this.colors[0].clone();
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: { uColor: { value: color }, uPhase: { value: 0 }, uAlpha: { value: 1 } },
      transparent: true,
      forceSinglePass: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'party-ping-ring';
    ring.renderOrder = RING_ORDER;
    ring.visible = false;
    this.group.add(ring);

    const stemMat = new THREE.ShaderMaterial({
      vertexShader: STEM_VERTEX,
      fragmentShader: STEM_FRAGMENT,
      uniforms: { uColor: { value: color }, uAlpha: { value: 1 } },
      transparent: true,
      forceSinglePass: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stem = new THREE.Mesh(this.stemGeo, stemMat);
    stem.name = 'party-ping-stem';
    stem.renderOrder = RING_ORDER + 1;
    stem.visible = false;
    this.group.add(stem);

    // The glow is built BEFORE the icon: the two share a position and an
    // order, three breaks the tie by id, so the glow lays its light first.
    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.6,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.name = 'party-ping-glow';
    glow.renderOrder = ICON_ORDER;
    glow.visible = false;
    this.group.add(glow);

    const iconMat = new THREE.SpriteMaterial({
      map: this.icons[0],
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const icon = new THREE.Sprite(iconMat);
    icon.name = 'party-ping-icon';
    icon.renderOrder = ICON_ORDER;
    icon.visible = false;
    this.group.add(icon);
    return { ring, ringMat, stem, stemMat, glow, glowMat, icon, iconMat };
  }

  /** The layer released its resources (a prewarm unit draining late does nothing). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Pings currently drawn (tests and the perf probe read it). */
  get shown(): number {
    return this.shownCount;
  }

  /**
   * One frame: fold the live pings into the slots, then pose each shown one
   * for `camera` (its unit's live position for a unit ping). `time` is the
   * renderer clock.
   */
  update(
    pings: readonly PartyPingMark[],
    camera: THREE.Camera,
    time: number,
    reducedMotion: boolean,
  ): void {
    if (this.disposed) return;
    const live = partyPingsEnabled() ? pings : NO_PINGS;
    if (syncPartyPingSlots(this.slots, live, time)) this.apply();
    if (this.shownCount === 0) return;
    const cam = camera.position;
    const persp = camera as THREE.PerspectiveCamera;
    const fov = persp.isPerspectiveCamera ? persp.fov : PARTY_PING_CAMERA_FOV;
    for (let s = 0; s < PARTY_PING_SLOTS; s++) {
      const slot = this.slots[s];
      if (slot.id === 0) continue;
      const piece = this.pieces[s];
      const age = time - slot.born;
      const unit = slot.target === null ? undefined : this.unitView(slot.target);
      let unitAt: typeof this.unitAt | null = null;
      if (unit) {
        const g = unit.group.position;
        this.unitAt.x = g.x;
        this.unitAt.y = g.y;
        this.unitAt.z = g.z;
        this.unitAt.top = g.y + unit.height * unit.group.scale.y;
        unitAt = this.unitAt;
      }
      const a = partyPingAnchorInto(this.anchor, slot, unitAt, partyPingBob(age, reducedMotion));
      const alpha = Math.max(0, partyPingAlpha(age));
      const pop = partyPingPop(age, reducedMotion);
      const dist = Math.hypot(a.x - cam.x, a.iconY - cam.y, a.z - cam.z);
      const size = partyPingIconSize(dist, fov) * pop;
      const iconY = partyPingIconY(a, slot, partyPingIconSize(dist, fov));
      piece.icon.position.set(a.x, iconY, a.z);
      piece.icon.scale.set(size, size, 1);
      piece.iconMat.opacity = alpha;
      piece.ring.position.set(a.x, a.y + 0.06, a.z);
      const ringScale = PARTY_PING_RING_RADIUS * Math.min(1, 0.4 + pop * 0.6);
      piece.ring.scale.set(ringScale, ringScale, 1);
      piece.ringMat.uniforms.uPhase.value = partyPingRipple(age, reducedMotion);
      piece.ringMat.uniforms.uAlpha.value = alpha;
      if (!this.lowTier) {
        piece.glow.position.set(a.x, iconY, a.z);
        piece.glow.scale.set(size * 1.6, size * 1.6, 1);
        piece.glowMat.opacity = 0.55 * alpha;
        piece.stem.position.set(a.x, a.y, a.z);
        piece.stem.scale.set(1, Math.max(0.01, iconY - a.y - size * 0.45), 1);
        piece.stemMat.uniforms.uAlpha.value = alpha;
      }
    }
  }

  private apply(): void {
    let shown = 0;
    for (let s = 0; s < PARTY_PING_SLOTS; s++) {
      const slot = this.slots[s];
      const piece = this.pieces[s];
      const on = slot.id !== 0;
      if (slot.dirty && on) {
        const color = this.colors[slot.kind] ?? this.colors[0];
        (piece.ringMat.uniforms.uColor.value as THREE.Color).copy(color);
        piece.glowMat.color.copy(color);
        piece.iconMat.map = this.icons[slot.kind] ?? this.icons[0];
      }
      piece.ring.visible = on;
      piece.icon.visible = on;
      // The cosmetic pieces: a unit ping's stem would cut through its unit.
      piece.glow.visible = on && !this.lowTier;
      piece.stem.visible = on && !this.lowTier && slot.target === null;
      if (on) shown++;
    }
    this.shownCount = shown;
  }

  /** Every texture the layer draws with: the five icons and the glow. */
  prewarmTextures(): THREE.Texture[] {
    if (this.disposed) return [];
    return [...this.icons, this.glowTexture];
  }

  /** A staged, VISIBLE twin of every piece (same geometry, same materials),
   *  off the scene: a compile walks only visible objects. Built once. */
  prewarmRoot(): THREE.Group {
    if (this.stagedRoot) return this.stagedRoot;
    const root = new THREE.Group();
    root.name = 'party-pings-prewarm';
    for (const p of this.pieces) {
      root.add(new THREE.Mesh(this.ringGeo, p.ringMat));
      root.add(new THREE.Mesh(this.stemGeo, p.stemMat));
      root.add(new THREE.Sprite(p.glowMat));
      root.add(new THREE.Sprite(p.iconMat));
    }
    root.position.y = -PARTY_PING_GROUND_LIFT;
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
      tryRelease(() => p.ringMat.dispose());
      tryRelease(() => p.stemMat.dispose());
      tryRelease(() => p.glowMat.dispose());
      tryRelease(() => p.iconMat.dispose());
    }
    tryRelease(() => this.ringGeo.dispose());
    tryRelease(() => this.stemGeo.dispose());
    for (const t of this.icons) tryRelease(() => t.dispose());
    tryRelease(() => this.glowTexture.dispose());
    if (errors.length > 0) throw new AggregateError(errors, 'party pings dispose failed');
  }
}

const NO_PINGS: readonly PartyPingMark[] = Object.freeze([]);

/** What the prewarm entry needs from the renderer (the world markers' host). */
export interface PartyPingPrewarmHost {
  prewarmTexture(texture: THREE.Texture): void;
  compileColor(root: THREE.Object3D): Promise<void>;
}

/**
 * The layer's world-entry prewarm manifest entry (`vfx.party-pings`): upload
 * the five icons and the glow, and link the ring, stem and sprite programs
 * through the staged twin, behind the loading curtain. A dropped entry
 * resumes its textures as cosmetic units and its programs as debt.
 */
export function partyPingPrewarmEntry(layer: PartyPingLayer, host: PartyPingPrewarmHost) {
  const link = async () => {
    if (!layer.isDisposed) await host.compileColor(layer.prewarmRoot());
  };
  return {
    id: 'vfx.party-pings',
    category: 'vfx' as const,
    priority: 62,
    required: false,
    resumeUnits: () =>
      layer.prewarmTextures().map((texture, i) => ({
        id: `texture:party-ping-${i}`,
        synchronous: true,
        run: () => {
          if (!layer.isDisposed) host.prewarmTexture(texture);
        },
      })),
    resumeProgramUnits: () => [{ id: 'link:party-pings', run: link }],
    run: async () => {
      for (const texture of layer.prewarmTextures()) host.prewarmTexture(texture);
      await link();
    },
  };
}
