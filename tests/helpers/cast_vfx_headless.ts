// The ability-VFX engine as the renderer builds it, headless: a canvas stub
// for the procedural textures, and a reading of which gated drawables would
// draw on the next frame. Shared by the cast gate's spawn and requirement
// pins. A suite that needs the Warrior fragments resident mocks
// production_assets' fragmentGeometry itself (vi.mock is hoisted per file).

import * as THREE from 'three';
import { vi } from 'vitest';
import { AbilityVfxFx } from '../../src/render/ability_vfx/fx';
import { AbilityVfx } from '../../src/render/ability_vfx/painter';
import {
  CAST_VFX_ENGINE,
  CAST_VFX_KIT,
  castVfxFamilyBitOf,
} from '../../src/render/cast_vfx_family';
import { createCastVfxReadiness } from '../../src/render/cast_vfx_readiness_core';
import { createVfxAnchor } from '../../src/render/vfx_anchor';

export function installCastVfxCanvasStub(): void {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'createImageData' || key === 'getImageData') {
          return (a: number, b: number, c?: number, d?: number) => ({
            data: new Uint8ClampedArray((c ?? a) * (d ?? b) * 4),
          });
        }
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
        if (key === 'createPattern') return () => gradient;
        if (key === 'measureText') return () => ({ width: 1 });
        return noop;
      },
      set: () => true,
    },
  );
  const canvas = () => ({
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
    addEventListener: noop,
    removeEventListener: noop,
  });
  vi.stubGlobal('document', { createElement: canvas, createElementNS: canvas });
}

/** Whether three would submit primitives for this object on the next frame:
 *  visible through its ancestors, and a non-empty instance or draw range. */
export function wouldDraw(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  const drawable = object as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
  if (drawable.isInstancedMesh) return (drawable.count ?? 0) > 0;
  const geometry = drawable.geometry as THREE.BufferGeometry | undefined;
  if (!geometry || !(object as THREE.Mesh).material) return false;
  const index = geometry.index;
  const position = geometry.getAttribute('position');
  const primitives = index ? index.count : position ? position.count : 0;
  return primitives > 0 && geometry.drawRange.count > 0;
}

/** Every family-tagged drawable in the scene, collected once (the pools are
 *  built at construction and never replaced). */
export function gatedDrawables(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (castVfxFamilyBitOf(object) !== 0 && (object as THREE.Mesh).material) out.push(object);
  });
  return out;
}

/** The union of the family bits of the gated drawables that would draw. */
export function drawingFamilies(drawables: readonly THREE.Object3D[]): number {
  let bits = 0;
  for (const object of drawables) if (wouldDraw(object)) bits |= castVfxFamilyBitOf(object);
  return bits;
}

/** Stubs ready every kit preparation a pool checks before its solid pieces
 *  draw (headless, none of them ever reports ready on its own). */
export function prepareCastVfxKit(fx: AbilityVfxFx): void {
  const pools = fx as unknown as Record<string, { preparation: unknown }>;
  const ready = { ready: () => true, units: () => [], dispose: () => {} };
  pools.crests.preparation = ready;
  pools.guards.preparation = ready;
  pools.spiritHammers.preparation = ready;
  pools.powerForms.preparation = [ready, ready, ready, ready];
  pools.furyStates.preparation = [ready, ready, ready];
}

/** A weapon in each hand of every entity, answering a point and a frame. */
function equippedWeapon(at: (id: number) => { x: number; z: number }) {
  return (id: number, hand: 0 | 1) =>
    Object.assign(
      (out: THREE.Vector3) => {
        const p = at(id);
        out.set(p.x + hand * 0.4, 1, p.z);
        return true;
      },
      {
        frame: (out: THREE.Matrix4) => {
          const p = at(id);
          out.makeTranslation(p.x + hand * 0.4, 1, p.z);
          return true;
        },
      },
    );
}

/** The real painter over the real engine, headless, behind the real cast
 *  gate core with one stand-in material per family: `prove(bit)` links a
 *  family, `step` renders a frame. The Vfx particle calls land in `vfx`.
 *  `equipped` gives every entity a weapon and a body and readies the kit's
 *  preparations, so the kit's solid pieces can draw; `localPlayerId` names
 *  the local player (the painter plans a local caster's casts apart). */
export function castGateRig(
  options: {
    kitDeclined?: boolean;
    deadlineMs?: number;
    equipped?: boolean;
    localPlayerId?: number;
    /** Rewrites every mask the painter asks for: a test stand-in for a
     *  requirement resolver that gets a mask wrong. */
    askedMask?: (mask: number) => number;
  } = {},
) {
  installCastVfxCanvasStub();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  camera.position.set(0, 4, 18);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const place = (id: number) => ({ x: (id % 7) * 2.5 - 6, z: -Math.floor(id / 7) * 2.5 });
  const fxAnchor = createVfxAnchor((id, pose) => {
    const at = place(id);
    pose.x = at.x;
    pose.y = 0;
    pose.z = at.z;
    pose.height = 2;
    return true;
  });
  const fx = options.equipped
    ? new AbilityVfxFx(
        scene,
        camera,
        fxAnchor,
        () => 0,
        () => 0,
        equippedWeapon(place),
        (id, hand, out) => {
          const at = place(id);
          out.x = at.x + hand * 0.4;
          out.y = 1;
          out.z = at.z;
          return true;
        },
        () => true,
        (id, _piece, out) => {
          const at = place(id);
          out.makeTranslation(at.x, 1, at.z);
          return true;
        },
        () => true,
      )
    : new AbilityVfxFx(
        scene,
        camera,
        fxAnchor,
        () => 0,
        () => 0,
      );
  if (options.equipped) prepareCastVfxKit(fx);
  const materials = [{ id: 'engine' }, { id: 'kit' }] as const;
  const proved = new Set<string>();
  const clock = { ms: 0, frame: 0 };
  const readiness = createCastVfxReadiness<{ id: string }>({
    now: () => clock.ms,
    frame: () => clock.frame,
    deadlineMs: options.deadlineMs ?? 30_000,
    families: [
      { id: 'engine', bit: CAST_VFX_ENGINE, materials: () => [materials[0]] },
      {
        id: 'kit',
        bit: CAST_VFX_KIT,
        materials: () => [materials[1]],
        declined: () => options.kitDeclined === true,
      },
    ],
    linked: (material) => (proved.has(material.id) ? material : null),
  });
  let asked = 0;
  fx.setCastVfxSpawnGate((bit) => {
    asked |= bit;
    return readiness.spawnAllowed(bit);
  });
  const vfxCalls: string[] = [];
  const record =
    (name: string) =>
    (..._args: unknown[]) => {
      vfxCalls.push(name);
    };
  const warriors = new Set<number>();
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile: record('projectile'),
        lightningProjectile: record('lightningProjectile'),
        burst: record('burst'),
        nova: record('nova'),
        tick: record('tick'),
        shoutwave: record('shoutwave'),
        buffSwirl: record('buffSwirl'),
        beam: record('beam'),
      },
      anchor: (id, heightFrac) => ({ ...place(id), y: heightFrac * 2 }),
      spawnAoeRing: () => {},
      triggerAttack: () => {},
      localPlayerId: () => options.localPlayerId ?? -99,
      isWarrior: (id) => warriors.has(id),
      isLivingWarrior: (id) => warriors.has(id),
      isMob: () => false,
      castingAbilityOf: () => null,
      castVfxAdmit: (mask) => readiness.admit(options.askedMask?.(mask) ?? mask),
      castVfxReady: (mask) => readiness.ready(options.askedMask?.(mask) ?? mask),
    },
    () => clock.ms / 1000,
  );
  const drawables = gatedDrawables(scene);
  const everDrew = new Set<THREE.Object3D>();
  let drawn = 0;
  const step = (frames = 1, dt = 1 / 20): number => {
    let seen = 0;
    for (let i = 0; i < frames; i++) {
      clock.frame++;
      clock.ms += dt * 1000;
      painter.update(dt);
      for (const object of drawables) {
        if (!wouldDraw(object)) continue;
        seen |= castVfxFamilyBitOf(object);
        everDrew.add(object);
      }
    }
    drawn |= seen;
    return seen;
  };
  return {
    scene,
    fx,
    painter,
    readiness,
    drawables,
    warriors,
    vfxCalls,
    clock,
    step,
    prove: (bit: number) => {
      if (bit & CAST_VFX_ENGINE) proved.add('engine');
      if (bit & CAST_VFX_KIT) proved.add('kit');
    },
    /** The families any gated drawable drew with since the last reset. */
    drawn: () => drawn,
    /** The families any gated pool asked to spawn from since the last reset. */
    asked: () => asked,
    /** Every gated drawable that drew at least once over the rig's life. */
    everDrew: () => everDrew,
    resetDrawn: () => {
      drawn = 0;
      asked = 0;
      vfxCalls.length = 0;
    },
    /** Back to an idle engine and painter, readiness kept. */
    reset: () => {
      fx.clear();
      painter.resetPresentation();
      drawn = 0;
      asked = 0;
      vfxCalls.length = 0;
    },
  };
}
