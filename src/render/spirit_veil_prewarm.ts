// The boot manifest entry that links the spirit veil's whole program family
// (`entities.spirit-veil-family`) before the loading curtain lifts: one hidden
// stand-in per pinned tuple (characters/spirit_veil_family_core.ts), each
// wearing the veil factory's OWN material so the linked key cannot drift from
// the live one, linked through the colour arm under the tier's target. The
// stand-ins are resident and never disposed, so three keeps their programs for
// the renderer's life and the ledger they fill stays true.
//
// It links inside its own run(), not as a staged group: a staged group links
// as post-paint debt, and a character saved dead logs in as a released spirit,
// so the self view is a ghost on the very first frame. Dropped by a deadline,
// its units resume as program debt (`programs.entities.spirit-veil-family`),
// and a ghost meanwhile waits behind the effect gate rather than linking live.
// A tuple outside the family (a census gap) is linked late, on the background
// queue, by a stand-in of its own.
//
// Each unit starts the touch tail (linked_program_touch_lane.ts) once its
// stand-in linked: the program's uniform and attribute tables are fetched as
// one budgeted queue unit at the boot lane's tail priority, which the loading
// cover admits. The entry's own run waits for those touches; a resumed unit
// only starts its touch and settles, because the resume lane runs a debt unit
// holding the queue, and a unit awaiting another unit of the same queue would
// never settle. Without it the first veil a live frame draws (a release, a
// stealth, a Keeper appearing) pays that reflection round trip inside the
// frame: the own-release frame on the HD 530 spent 7.2 ms on 274 first-use
// uniform queries of the veil and the old twins.

import * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import {
  bindSpiritVeilLedger,
  createSpiritVeilMaterial,
  noteSpiritVeilTupleLinked,
  setSpiritVeilLateLink,
  spiritVeilDepthMaterial,
  spiritVeilLedgerOwnedBy,
  spiritVeilLedgerSize,
} from './characters/ghost_veil';
import {
  SPIRIT_VEIL_FAMILY,
  SPIRIT_VEIL_FAMILY_KEYS,
  type SpiritVeilTuple,
  spiritVeilKeyOfTuple,
  spiritVeilTupleOfKey,
} from './characters/spirit_veil_family_core';
import { type CompileArmHost, linkColorPrograms } from './compile_arms';
import { markProgramsReadyUnder } from './linked_program_readiness';
import { runLinkedProgramTouchLane } from './linked_program_touch_lane';
import type { PrewarmManifestEntry } from './prewarm_entry';
import type { PrewarmResumeUnit } from './prewarm_resume';

export const SPIRIT_VEIL_PREWARM_ENTRY_ID = 'entities.spirit-veil-family';

let standInMap: THREE.DataTexture | null = null;

function standInSourceMap(): THREE.DataTexture {
  standInMap ??= new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return standInMap;
}

/** A three-vertex mesh with exactly the tuple's shape: positions, normals and
 *  uvs, a SkinnedMesh with skin attributes for a skinned tuple (three keys
 *  skinning on the object kind alone, and a link never binds a skeleton), N
 *  zero position morphs, and the veil material the live path would mount. */
export function buildSpiritVeilStandIn(tuple: SpiritVeilTuple): THREE.Mesh {
  const key = spiritVeilKeyOfTuple(tuple);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  if (tuple.skinned) {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
  }
  if (tuple.morphTargets > 0) {
    geometry.morphAttributes.position = Array.from(
      { length: tuple.morphTargets },
      () => new THREE.Float32BufferAttribute(new Float32Array(9), 3),
    );
    geometry.morphTargetsRelative = true;
  }
  const material =
    tuple.pass === 'depth'
      ? spiritVeilDepthMaterial(key)
      : createSpiritVeilMaterial(
          new THREE.MeshBasicMaterial({
            map: tuple.map ? standInSourceMap() : null,
            transparent: tuple.pass === 'decal',
          }),
        );
  const mesh = tuple.skinned
    ? new THREE.SkinnedMesh(geometry, material)
    : new THREE.Mesh(geometry, material);
  mesh.name = `spirit-veil-stand-in:${key}`;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

const standIns = new Map<string, THREE.Mesh>();

function standInFor(tuple: SpiritVeilTuple): THREE.Mesh {
  const key = spiritVeilKeyOfTuple(tuple);
  let mesh = standIns.get(key);
  if (!mesh) {
    mesh = buildSpiritVeilStandIn(tuple);
    standIns.set(key, mesh);
  }
  return mesh;
}

export interface SpiritVeilGpuQueue {
  run<T>(
    work: () => T | Promise<T>,
    priority?: number,
    label?: string,
    options?: { releaseTail?: boolean },
  ): Promise<T>;
}

export interface SpiritVeilPrewarmHost {
  arms: CompileArmHost;
  /** The renderer's per-material state, the settle record's source and the
   *  ledger's owner. Read at each use, never kept: a context restore gives the
   *  renderer a new one, and the old one's programs died with the old context. */
  readonly properties: { get(material: THREE.Material): unknown };
  queue: SpiritVeilGpuQueue;
  /** Test seam: the colour arm's link. */
  link?: (root: THREE.Object3D) => Promise<void>;
}

/** The touch tail of one linked stand-in; never rejects. */
function touchStandIn(host: SpiritVeilPrewarmHost, root: THREE.Object3D): Promise<unknown> {
  return runLinkedProgramTouchLane(host.queue, host.properties, root, GPU_WORK_PRIORITY.BOOT_DEBT, {
    settled: false,
  }).catch(() => 0);
}

/** Record a linked stand-in under the program cache it linked on, and only
 *  while the renderer still holds that cache: a restore mid-link swaps it. */
function recordLinked(
  host: SpiritVeilPrewarmHost,
  key: string,
  root: THREE.Object3D,
  linkedUnder: SpiritVeilPrewarmHost['properties'],
): boolean {
  if (host.properties !== linkedUnder) return false;
  markProgramsReadyUnder(linkedUnder, root);
  noteSpiritVeilTupleLinked(key, linkedUnder);
  return true;
}

/** One unit per tuple: link its stand-in, record the settle, mark the tuple,
 *  then start the touch of the linked program's tables, handed to `touches`
 *  when the caller will wait for them. `claimLedger` runs before each link. */
export function spiritVeilProgramUnits(
  host: SpiritVeilPrewarmHost,
  claimLedger: () => void,
  touches?: Promise<unknown>[],
): PrewarmResumeUnit[] {
  const link = host.link ?? ((root) => linkColorPrograms(host.arms, root, false));
  return SPIRIT_VEIL_FAMILY.map((tuple) => {
    const key = spiritVeilKeyOfTuple(tuple);
    const root = standInFor(tuple);
    return {
      id: `spirit-veil:${key}`,
      roots: [root],
      run: () => {
        claimLedger();
        const linkedUnder = host.properties;
        return link(root).then(() => {
          if (recordLinked(host, key, root, linkedUnder)) touches?.push(touchStandIn(host, root));
        });
      },
    };
  });
}

function installLateLink(host: SpiritVeilPrewarmHost): void {
  const link = host.link ?? ((root) => linkColorPrograms(host.arms, root, false));
  const inFlight = new Set<string>();
  setSpiritVeilLateLink((keys) => {
    // A renderer the ledger no longer belongs to (retired by a rebuild) links
    // nothing more on its shut-down queue.
    const linkedUnder = host.properties;
    if (!spiritVeilLedgerOwnedBy(linkedUnder)) return;
    for (const key of keys) {
      // The family's own tuples are the boot entry's (or its resume debt's).
      if (SPIRIT_VEIL_FAMILY_KEYS.has(key) || inFlight.has(key)) continue;
      const tuple = spiritVeilTupleOfKey(key);
      if (!tuple) continue;
      inFlight.add(key);
      const root = standInFor(tuple);
      void host.queue
        .run(() => link(root), GPU_WORK_PRIORITY.BACKGROUND, `spirit-veil-late:${key}`, {
          releaseTail: true,
        })
        .then(() =>
          recordLinked(host, key, root, linkedUnder) ? touchStandIn(host, root) : undefined,
        )
        .catch(() => undefined)
        .finally(() => inFlight.delete(key));
    }
  });
}

/** The manifest entry, minus its id (the renderer's manifest spells the id so
 *  the manifest pins read it). Binds the ledger to this renderer. */
export function spiritVeilFamilyPrewarmEntry(
  arms: CompileArmHost,
  webgl: { readonly properties: SpiritVeilPrewarmHost['properties'] },
  queue: SpiritVeilGpuQueue,
  link?: SpiritVeilPrewarmHost['link'],
): Omit<PrewarmManifestEntry, 'id'> {
  const host: SpiritVeilPrewarmHost = {
    arms,
    get properties() {
      return webgl.properties;
    },
    queue,
    link,
  };
  let bound: object = host.properties;
  bindSpiritVeilLedger(bound);
  installLateLink(host);
  // A run follows its own renderer onto new properties (a restored context),
  // but never takes the ledger from another renderer: a graphics rebuild's
  // successor owns it, and this retired one's settles must record nothing.
  const claimLedger = (): void => {
    const live = host.properties;
    if (spiritVeilLedgerOwnedBy(live)) return;
    if (!spiritVeilLedgerOwnedBy(bound) && !spiritVeilLedgerOwnedBy(null)) return;
    bound = live;
    bindSpiritVeilLedger(live);
    installLateLink(host);
  };
  return {
    category: 'entities',
    priority: 47,
    required: false,
    resumeProgramUnits: () => spiritVeilProgramUnits(host, claimLedger, []),
    run: async () => {
      const touches: Promise<unknown>[] = [];
      await Promise.all(
        spiritVeilProgramUnits(host, claimLedger, touches).map((unit) => unit.run()),
      );
      await Promise.all(touches);
    },
    detail: () => `tuples=${SPIRIT_VEIL_FAMILY.length};linked=${spiritVeilLedgerSize()}`,
  };
}
