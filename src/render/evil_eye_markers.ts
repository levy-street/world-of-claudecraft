import * as THREE from 'three';
import type { IWorld } from '../world_api';
import {
  type EvilEyeMarkerKind,
  evilEyeMarkerKind,
  fateThreadMarkerState,
  hasPossessedEvilEye,
} from './evil_eye_marker_core';

const EYE_SIZE = 96;
const EYE_BASE_Y = 0.68;
const EYE_BOB = 0.07;
/** How far below the model's top the Rot Splinters lodge, in host units. */
const SPLINTER_DEPTH = 0.55;
/** Pale bone at the jutting end fading to rot green where it sinks in. */
const SPLINTER_OUTER = new THREE.Color(0xe4efb0);
const SPLINTER_INNER = new THREE.Color(0x5cb321);

type Rgb = readonly [number, number, number];

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Rot drips hanging under the lower lid: [x offset, length] in eye units. */
const ROTMARK_DRIPS: ReadonlyArray<readonly [number, number]> = [
  [-0.32, 0.38],
  [0.06, 0.52],
  [0.38, 0.3],
];

/** The Rotmark: the old curse eye gone diseased. Bone sclera cut by rot veins,
 *  a slit pupil in a sick green iris, and three green drips under the lid. */
function rotmarkPixel(nx: number, ny: number): Rgb | null {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const lid = 0.4 * (1 - ax ** 1.45);
  const r = Math.hypot(nx, ny);
  const inside = ax <= 0.94 && ay <= lid;
  const onLid = ax <= 0.97 && Math.abs(ay - lid) <= 0.06;
  if (onLid) return ny > 0 ? [58, 74, 22] : [44, 58, 16];
  if (inside) {
    if (ax < 0.05 && ay < 0.24) return [10, 18, 4];
    if (r <= 0.32) return mixRgb([196, 255, 110], [52, 110, 18], r / 0.32);
    const vein = Math.abs(Math.sin(Math.atan2(ny, nx) * 7 + r * 9)) < 0.09;
    if (vein) return [110, 120, 40];
    return mixRgb([232, 226, 180], [168, 160, 112], (r - 0.32) / 0.6);
  }
  for (const [dx, length] of ROTMARK_DRIPS) {
    const top = -0.4 * (1 - Math.abs(dx) ** 1.45);
    const bottom = top - length;
    const t = (top - ny) / length;
    if (ny <= top && ny >= bottom && Math.abs(nx - dx) <= 0.045 * (1 - t * 0.5)) {
      return [118, 200, 52];
    }
    if (Math.hypot(nx - dx, ny - (bottom - 0.04)) <= 0.075) return [150, 230, 70];
  }
  return null;
}

function eyeTexture(): THREE.DataTexture {
  const data = new Uint8Array(EYE_SIZE * EYE_SIZE * 4);
  const center = (EYE_SIZE - 1) / 2;
  for (let y = 0; y < EYE_SIZE; y++) {
    for (let x = 0; x < EYE_SIZE; x++) {
      // DataTexture row 0 is the bottom, so ny grows upward.
      const pixel = rotmarkPixel((x - center) / center, (y - center) / center);
      if (!pixel) continue;
      const offset = (y * EYE_SIZE + x) * 4;
      data[offset] = pixel[0];
      data[offset + 1] = pixel[1];
      data[offset + 2] = pixel[2];
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, EYE_SIZE, EYE_SIZE, THREE.RGBAFormat);
  // The pixel colours above are authored sRGB; tagging them keeps the bone and
  // rot greens from washing out pale under the renderer's sRGB output.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface EvilEyeHostView {
  group: THREE.Group;
  height: number;
}

interface MarkerEntry {
  sprite: THREE.Sprite;
  group: THREE.Group;
  kind: EvilEyeMarkerKind;
  possessed: boolean;
  phase: number;
  splinters: Array<{
    pivot: THREE.Group;
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    material: THREE.MeshBasicMaterial;
  }>;
}

/** Floating Rotmark eyes driven solely by replicated primary and Coven auras. */
export class EvilEyeMarkers {
  private readonly markers = new Map<number, MarkerEntry>();
  private readonly texture = eyeTexture();
  private readonly primaryMaterial = new THREE.SpriteMaterial({
    map: this.texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  private readonly secondaryMaterial = new THREE.SpriteMaterial({
    map: this.texture,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: true,
  });
  private readonly possessedMaterial = new THREE.SpriteMaterial({
    map: this.texture,
    color: 0xbaffcf,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  /** Three Rot Splinters, one per held stack: jagged bone shards stuck in the
   *  Rotmark target, jutting out pale and sinking in rot green. */
  private buildSplinters(): MarkerEntry['splinters'] {
    return [0, 1, 2].map((index) => {
      // A five-sided cone, its rim vertices pushed in and out so the shard
      // reads as split wood or bone instead of a clean spike.
      const geometry = new THREE.ConeGeometry(0.085, 0.66, 5, 3);
      const position = geometry.getAttribute('position');
      const colors = new Float32Array(position.count * 3);
      const color = new THREE.Color();
      for (let v = 0; v < position.count; v++) {
        const y = position.getY(v);
        const along = (y + 0.33) / 0.66; // 0 at the jutting base, 1 at the buried tip
        if (along < 0.99) {
          const jag = 0.7 + ((v * 7 + index * 3) % 5) * 0.15;
          position.setX(v, position.getX(v) * jag);
          position.setZ(v, position.getZ(v) * jag);
        }
        color.copy(SPLINTER_OUTER).lerp(SPLINTER_INNER, Math.min(1, along * 1.6));
        colors[v * 3] = color.r;
        colors[v * 3 + 1] = color.g;
        colors[v * 3 + 2] = color.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Tip pointing in toward the body and a little down, like a dart that
      // struck from above; the pivot's y rotation spaces the three around it.
      mesh.position.set(0.5, 0, 0);
      mesh.rotation.z = Math.PI / 2 + 0.38 + index * 0.08;
      mesh.renderOrder = 8;
      const pivot = new THREE.Group();
      pivot.name = `rot-splinter-${index + 1}`;
      pivot.visible = false;
      pivot.add(mesh);
      return { pivot, mesh, material };
    });
  }

  private removeMarker(id: number): void {
    const entry = this.markers.get(id);
    if (!entry) return;
    entry.sprite.removeFromParent();
    for (const splinter of entry.splinters) {
      splinter.pivot.removeFromParent();
      splinter.mesh.geometry.dispose();
      splinter.material.dispose();
    }
    this.markers.delete(id);
  }

  update(world: IWorld, views: ReadonlyMap<number, EvilEyeHostView>, reducedMotion = false): void {
    const owner = world.entities.get(world.playerId);
    const possessed = hasPossessedEvilEye(owner);
    for (const [id, entry] of this.markers) {
      const entity = world.entities.get(id);
      const view = views.get(id);
      const kind = entity ? evilEyeMarkerKind(entity, world.playerId) : null;
      const entryPossessed = kind === 'primary' && possessed;
      if (
        !entity ||
        !view ||
        view.group !== entry.group ||
        kind !== entry.kind ||
        entryPossessed !== entry.possessed
      ) {
        this.removeMarker(id);
      }
    }

    for (const [id, view] of views) {
      if (this.markers.has(id)) continue;
      const entity = world.entities.get(id);
      if (!entity) continue;
      const kind = evilEyeMarkerKind(entity, world.playerId);
      if (!kind) continue;
      const markerPossessed = kind === 'primary' && possessed;
      const sprite = new THREE.Sprite(
        markerPossessed
          ? this.possessedMaterial
          : kind === 'primary'
            ? this.primaryMaterial
            : this.secondaryMaterial,
      );
      sprite.name = `evil-eye-${kind}`;
      view.group.add(sprite);
      const splinters = this.buildSplinters();
      for (const splinter of splinters) view.group.add(splinter.pivot);
      this.markers.set(id, {
        sprite,
        group: view.group,
        kind,
        possessed: markerPossessed,
        phase: (id % 9) * 0.65,
        splinters,
      });
    }

    const time = performance.now() / 1000;
    for (const [id, entry] of this.markers) {
      const entity = world.entities.get(id);
      const view = views.get(id);
      if (!entity || !view) continue;
      const hostScale = Math.max(0.01, entity.scale);
      const bob = reducedMotion ? 0 : Math.sin((time + entry.phase) * Math.PI * 2) * EYE_BOB;
      entry.sprite.position.y = view.height + (EYE_BASE_Y + bob) / hostScale;
      const pulse = reducedMotion ? 1 : 1 + Math.sin((time + entry.phase) * Math.PI * 3) * 0.055;
      const kindScale = entry.possessed ? 1.35 : entry.kind === 'primary' ? 1 : 0.82;
      const scale = (kindScale * pulse) / hostScale;
      entry.sprite.scale.set(scale, scale, 1);
      const threadState =
        entry.kind === 'primary' && owner ? fateThreadMarkerState(owner, world.playerId) : null;
      const expiry =
        threadState === null
          ? 0
          : Math.min(1, Math.max(0.25, threadState.remaining / threadState.duration));
      entry.splinters.forEach((splinter, index) => {
        const visible = index < (threadState?.stacks ?? 0);
        splinter.pivot.visible = visible;
        if (!visible) return;
        // Lodged in the upper body, a third of a turn apart, swaying a little
        // as if the rot still twitches in the wound.
        splinter.pivot.position.y = view.height - SPLINTER_DEPTH / hostScale;
        splinter.pivot.scale.setScalar(1 / hostScale);
        splinter.pivot.rotation.y =
          index * ((Math.PI * 2) / 3) +
          entry.phase +
          (reducedMotion ? 0 : Math.sin((time + index * 0.7) * 1.6) * 0.12);
        splinter.material.opacity = (0.62 + (threadState?.stacks ?? 0) * 0.1) * expiry;
      });
    }
  }

  clear(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
  }
}
