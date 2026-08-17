import * as THREE from 'three';
import type { IWorld } from '../world_api';
import {
  type EvilEyeMarkerKind,
  evilEyeMarkerKind,
  fateThreadMarkerState,
  hasPossessedEvilEye,
} from './evil_eye_marker_core';

const EYE_SIZE = 64;
const EYE_BASE_Y = 0.68;
const EYE_BOB = 0.07;

function eyeTexture(): THREE.DataTexture {
  const data = new Uint8Array(EYE_SIZE * EYE_SIZE * 4);
  const center = (EYE_SIZE - 1) / 2;
  for (let y = 0; y < EYE_SIZE; y++) {
    for (let x = 0; x < EYE_SIZE; x++) {
      const nx = (x - center) / center;
      const ny = (y - center) / center;
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const lid = 0.38 * (1 - ax ** 1.45);
      const insideEye = ax <= 0.94 && ay <= lid;
      const onLid = ax <= 0.96 && Math.abs(ay - lid) <= 0.055;
      const irisRadius = Math.hypot(nx * 1.02, ny * 1.02);
      const iris = insideEye && irisRadius <= 0.29;
      const pupil = irisRadius <= 0.105;
      if (!insideEye && !onLid) continue;

      const offset = (y * EYE_SIZE + x) * 4;
      if (pupil) {
        data[offset] = 15;
        data[offset + 1] = 5;
        data[offset + 2] = 24;
      } else if (iris) {
        data[offset] = 78;
        data[offset + 1] = 255;
        data[offset + 2] = 129;
      } else if (onLid) {
        data[offset] = 186;
        data[offset + 1] = 67;
        data[offset + 2] = 255;
      } else {
        data[offset] = 106;
        data[offset + 1] = 25;
        data[offset + 2] = 152;
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, EYE_SIZE, EYE_SIZE, THREE.RGBAFormat);
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
  threads: Array<{
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    material: THREE.LineBasicMaterial;
  }>;
}

/** Floating curse eyes driven solely by replicated primary and Coven auras. */
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

  private buildThreads(): MarkerEntry['threads'] {
    return [0, 1, 2].map((thread) => {
      const points: THREE.Vector3[] = [];
      for (let segment = 0; segment <= 56; segment++) {
        const progress = segment / 56;
        const angle = progress * Math.PI * 4 + thread * ((Math.PI * 2) / 3);
        const radius = 0.12 + Math.sin(progress * Math.PI) * (0.43 + thread * 0.08);
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * radius,
            0.95 - progress * 1.42,
            Math.sin(angle) * radius,
          ),
        );
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: [0xb65dff, 0x79eed6, 0xe6d1ff][thread],
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.name = `fate-thread-${thread + 1}`;
      line.visible = false;
      line.renderOrder = 8;
      return { line, material };
    });
  }

  private removeMarker(id: number): void {
    const entry = this.markers.get(id);
    if (!entry) return;
    entry.sprite.removeFromParent();
    for (const thread of entry.threads) {
      thread.line.removeFromParent();
      thread.line.geometry.dispose();
      thread.material.dispose();
    }
    this.markers.delete(id);
  }

  update(world: IWorld, views: ReadonlyMap<number, EvilEyeHostView>, reducedMotion = false): void {
    const possessed = hasPossessedEvilEye(world.entities.get(world.playerId));
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
      const threads = this.buildThreads();
      for (const thread of threads) view.group.add(thread.line);
      this.markers.set(id, {
        sprite,
        group: view.group,
        kind,
        possessed: markerPossessed,
        phase: (id % 9) * 0.65,
        threads,
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
        entry.kind === 'primary' ? fateThreadMarkerState(entity, world.playerId) : null;
      const expiry =
        threadState === null
          ? 0
          : Math.min(1, Math.max(0.25, threadState.remaining / threadState.duration));
      entry.threads.forEach((thread, index) => {
        const visible = index < (threadState?.stacks ?? 0);
        thread.line.visible = visible;
        if (!visible) return;
        thread.line.position.y = view.height - 0.18 / hostScale;
        thread.line.scale.setScalar(1 / hostScale);
        thread.line.rotation.y = reducedMotion
          ? index * ((Math.PI * 2) / 3)
          : time * (index % 2 === 0 ? 0.55 : -0.48) + entry.phase + index * 1.9;
        thread.material.opacity = (0.48 + (threadState?.stacks ?? 0) * 0.09) * expiry * pulse;
      });
    }
  }

  clear(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
  }
}
