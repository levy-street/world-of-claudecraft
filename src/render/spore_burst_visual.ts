// Spore Burst presentation (druid): the spore burster mushroom growing on its
// fuse, the splash ring on the ground, and the countdown above it. The state
// comes from IWorld (activeSporeBursts, replicated like a Consecration), so a
// late-joining or reconnecting client sees the same mushroom and timer as the
// caster. The burst itself is the spellfxAt 'sporeBurst' cue the renderer
// routes to the generic ground burst.
//
// The timer and the ring are actionable (allies step in, enemies step out),
// so they ignore every graphics tier and reduced motion: green for a friendly
// caster, red for one the viewer may fight. Only the growth wobble is cosmetic.
import * as THREE from 'three';
import type { ActiveSporeBurst } from '../world_api';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';

const MODEL_URL = '/models/props/spore_burster.glb';
/** The GLB is authored at Dragonkin Egg height (about 1.05 yd); it grows to
 *  GROWN_SCALE of that over the fuse, then swells a little more just before
 *  it bursts. */
const GROWN_SCALE = 1.5;
const SWELL_SCALE = 1.62;
const SWELL_SECONDS = 0.35;
const MODEL_HEIGHT = 1.05;
const TIMER_GAP = 0.45;
/** The timer keeps a constant on-screen size (sizeAttenuation off, like a
 *  nameplate), so it reads at any range: this is its height as a fraction of
 *  the viewport. */
const TIMER_SCREEN_HEIGHT = 0.05;
/** The countdown floats above the mushroom, off the floor ladder: like a
 *  nameplate it draws after every floor band (depthTest off), so no telegraph
 *  can cover the number. */
const TIMER_RENDER_ORDER = 1000;
const RING_WIDTH = 0.14;
const RING_SEGMENTS = 64;
const GROUND_LIFT = 0.06;
const FRIENDLY_COLOR = 0x5fe06a;
const HOSTILE_COLOR = 0xff4d40;
const TIMER_CANVAS_W = 128;
const TIMER_CANVAS_H = 64;

let loadedModel: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  // Deferred, never eager (tests/defer_launcher_preloads.test.ts).
  registerDeferredPreload(() =>
    loadGltf(MODEL_URL).then((gltf) => {
      loadedModel = gltf.scene;
    }),
  );
}

/** Test seam: the asset this module loads (tests/spore_burst_visual.test.ts). */
export const sporeBurstVisualPreloadInternalsForTest = { modelUrl: MODEL_URL };

/** The mushroom's scale at a point of its fuse: 1 at placement, GROWN_SCALE
 *  at the burst, with a short extra swell over the last SWELL_SECONDS. Pure,
 *  so the growth curve is pinned without a renderer. */
export function sporeBurstScale(elapsed: number, duration: number): number {
  const fuse = Math.max(0.1, duration);
  const t = Math.min(1, Math.max(0, elapsed / fuse));
  // Ease-out: most of the growth reads early, so the mushroom is clearly
  // bigger within a second of landing.
  const grown = 1 + (GROWN_SCALE - 1) * (1 - (1 - t) * (1 - t));
  const swellStart = fuse - SWELL_SECONDS;
  if (elapsed <= swellStart) return grown;
  const s = Math.min(1, (elapsed - swellStart) / SWELL_SECONDS);
  return grown + (SWELL_SCALE - GROWN_SCALE) * s * s;
}

/** The countdown the timer prints: tenths of a second, never below 0.1 while
 *  the mushroom stands. */
export function sporeBurstTimerText(remaining: number): string {
  return Math.max(0.1, Math.ceil(remaining * 10 - 1e-6) / 10).toFixed(1);
}

interface SporeBurstVisual {
  root: THREE.Group;
  model: THREE.Object3D | null;
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  fill: THREE.Mesh;
  fillMaterial: THREE.MeshBasicMaterial;
  timer: THREE.Sprite | null;
  timerMaterial: THREE.SpriteMaterial | null;
  timerTexture: THREE.CanvasTexture | null;
  timerCanvas: HTMLCanvasElement | null;
  timerText: string;
  hostile: boolean;
  duration: number;
  elapsed: number;
  lastRemaining: number;
  phase: number;
}

export class SporeBurstVisuals {
  private readonly active = new Map<string, SporeBurstVisual>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    /** Is this caster one the local viewer may fight right now? */
    private readonly isHostileCaster: (sourceId: number) => boolean,
    /** The renderer's world compile gate: the GLB's programs link before the
     *  model shows. Only the model waits; the ring and the timer are
     *  actionable and attach at once on prewarmed basic materials. */
    private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {}

  sync(states: readonly ActiveSporeBurst[]): void {
    const ids = new Set<string>();
    for (const state of states) {
      ids.add(state.id);
      let visual = this.active.get(state.id);
      if (!visual) {
        visual = this.create(state);
        this.active.set(state.id, visual);
      }
      // The readout is authoritative; between snapshots the local clock
      // carries the countdown, re-anchored whenever a new remaining lands.
      if (visual.lastRemaining !== state.remaining) {
        visual.duration = Math.max(0.1, state.duration);
        visual.elapsed = Math.max(0, visual.duration - state.remaining);
        visual.lastRemaining = state.remaining;
      }
      const hostile = this.isHostileCaster(state.sourceId);
      if (hostile !== visual.hostile) this.setHostile(visual, hostile);
    }
    for (const [id, visual] of this.active) {
      if (ids.has(id)) continue;
      this.disposeVisual(visual);
      this.active.delete(id);
    }
  }

  update(dt: number, reducedMotion = false): void {
    for (const visual of this.active.values()) {
      visual.elapsed = Math.min(visual.duration, visual.elapsed + Math.max(0, dt));
      if (!visual.model && loadedModel) this.attachModel(visual);
      const scale = sporeBurstScale(visual.elapsed, visual.duration);
      if (visual.model) {
        visual.model.scale.setScalar(scale);
        if (!reducedMotion) {
          const wobble = 0.035 + 0.05 * (visual.elapsed / visual.duration);
          visual.model.rotation.z = Math.sin(visual.elapsed * 7 + visual.phase) * wobble;
          visual.model.rotation.x = Math.cos(visual.elapsed * 5.3 + visual.phase) * wobble * 0.6;
        } else {
          visual.model.rotation.set(0, visual.model.rotation.y, 0);
        }
      }
      if (visual.timer) {
        visual.timer.position.y = MODEL_HEIGHT * scale + TIMER_GAP;
        const text = sporeBurstTimerText(visual.duration - visual.elapsed);
        if (text !== visual.timerText) this.drawTimer(visual, text);
      }
    }
  }

  dispose(): void {
    for (const visual of this.active.values()) this.disposeVisual(visual);
    this.active.clear();
  }

  private create(state: ActiveSporeBurst): SporeBurstVisual {
    const centerY = this.groundY(state.x, state.z);
    const root = new THREE.Group();
    root.name = 'spore-burst';
    root.position.set(state.x, centerY, state.z);
    const ringMaterial = this.floorMaterial(FRIENDLY_COLOR, 0.75);
    const ring = new THREE.Mesh(
      this.terrainRing(state.x, state.z, centerY, state.radius - RING_WIDTH, state.radius),
      ringMaterial,
    );
    ring.name = 'spore-burst-ring';
    ring.renderOrder = floorVfxRenderOrder('player', 1);
    root.add(ring);
    const fillMaterial = this.floorMaterial(FRIENDLY_COLOR, 0.08);
    const fill = new THREE.Mesh(
      this.terrainRing(state.x, state.z, centerY, 0, state.radius - RING_WIDTH),
      fillMaterial,
    );
    fill.name = 'spore-burst-fill';
    fill.renderOrder = floorVfxRenderOrder('player', 0);
    root.add(fill);

    const visual: SporeBurstVisual = {
      root,
      model: null,
      ring,
      ringMaterial,
      fill,
      fillMaterial,
      timer: null,
      timerMaterial: null,
      timerTexture: null,
      timerCanvas: null,
      timerText: '',
      hostile: false,
      duration: Math.max(0.1, state.duration),
      elapsed: Math.max(0, state.duration - state.remaining),
      lastRemaining: state.remaining,
      // Deterministic per-mushroom wobble offset from its stable id.
      phase: hashPhase(state.id),
    };
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = TIMER_CANVAS_W;
      canvas.height = TIMER_CANVAS_H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = 'spore-burst-timer';
      sprite.scale.set(
        (TIMER_SCREEN_HEIGHT * TIMER_CANVAS_W) / TIMER_CANVAS_H,
        TIMER_SCREEN_HEIGHT,
        1,
      );
      sprite.renderOrder = TIMER_RENDER_ORDER;
      root.add(sprite);
      visual.timer = sprite;
      visual.timerMaterial = material;
      visual.timerTexture = texture;
      visual.timerCanvas = canvas;
    }
    if (loadedModel) this.attachModel(visual);
    this.setHostile(visual, this.isHostileCaster(state.sourceId));
    this.scene.add(root);
    return visual;
  }

  private attachModel(visual: SporeBurstVisual): void {
    if (!loadedModel) return;
    // The loader cache is immutable: only this transform graph is ours;
    // geometry, textures and materials stay shared and are never disposed.
    const model = loadedModel.clone(true);
    model.name = 'spore-burster-model';
    model.rotation.y = visual.phase * 2;
    visual.model = model;
    void attachSceneGroupGated(visual.root, model, this.compileGate).catch(() => {
      // Retired mid-compile: the root is already gone with its visual.
    });
  }

  private setHostile(visual: SporeBurstVisual, hostile: boolean): void {
    visual.hostile = hostile;
    const color = hostile ? HOSTILE_COLOR : FRIENDLY_COLOR;
    visual.ringMaterial.color.setHex(color);
    visual.fillMaterial.color.setHex(color);
    visual.timerText = '';
    if (visual.timer) this.drawTimer(visual, sporeBurstTimerText(visual.duration - visual.elapsed));
  }

  private drawTimer(visual: SporeBurstVisual, text: string): void {
    visual.timerText = text;
    const canvas = visual.timerCanvas;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !visual.timerTexture) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = `bold ${Math.round(canvas.height * 0.72)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, canvas.width / 2, canvas.height / 2 + 2);
    g.fillStyle = visual.hostile ? '#ff5a4d' : '#6ff07a';
    g.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    visual.timerTexture.needsUpdate = true;
  }

  private floorMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /** An annulus (or a disc at inner 0) draped onto the terrain, in the root's
   *  local frame, so the splash reads on slopes instead of clipping. */
  private terrainRing(
    cx: number,
    cz: number,
    centerY: number,
    inner: number,
    outer: number,
  ): THREE.BufferGeometry {
    const geometry = new THREE.RingGeometry(Math.max(0, inner), outer, RING_SEGMENTS, 1);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.groundY(cx + x, cz + z) - centerY + GROUND_LIFT);
    }
    pos.needsUpdate = true;
    geometry.computeBoundingSphere();
    return geometry;
  }

  private disposeVisual(visual: SporeBurstVisual): void {
    this.scene.remove(visual.root);
    visual.ring.geometry.dispose();
    visual.fill.geometry.dispose();
    visual.ringMaterial.dispose();
    visual.fillMaterial.dispose();
    visual.timerTexture?.dispose();
    visual.timerMaterial?.dispose();
  }
}

function hashPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}
