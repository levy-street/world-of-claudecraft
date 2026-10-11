import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ContactQueue, heldUntilCollapse } from '../src/render/contact_queue';
import {
  type PaladinAvengingWrathVisual,
  syncPaladinAvengingWrathVisual,
} from '../src/render/paladin_avenging_wrath_visual';

describe('Paladin Zealwing visual', () => {
  it('keeps two physical golden wings visible and freezes their pose for reduced motion', () => {
    const parent = new THREE.Group();
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, false);
    expect(visual).not.toBeNull();
    if (!visual) throw new Error('missing Zealwing visual');

    const left = parent.getObjectByName('paladin-avenging-wrath-left-wing');
    const right = parent.getObjectByName('paladin-avenging-wrath-right-wing');
    const feathers = parent.getObjectByName(
      'paladin-avenging-wrath-left-feathers',
    ) as THREE.InstancedMesh;
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(feathers).toBeInstanceOf(THREE.InstancedMesh);
    expect(feathers.count).toBe(6);
    expect((feathers.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffd84a);

    const openPose = left?.rotation.z;
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, false);
    expect(left?.rotation.z).not.toBe(openPose);
    const reducedPose = left?.rotation.z;
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, true);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, true);
    expect(left?.rotation.z).toBe(reducedPose);

    const dispose = vi.spyOn(visual.material, 'dispose');
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0, false)).toBeNull();
    expect(parent.getObjectByName('paladin-avenging-wrath')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('is wired into the renderer aura scan and entity visual lifecycle', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain('if (isPaladinWingAura(a)) hasPaladinWings = true');
    expect(renderer).toContain('v.paladinAvengingWrathVisual = syncPaladinAvengingWrathVisual(');
    expect(renderer).toContain('v.paladinAvengingWrathVisual?.dispose()');
    expect(renderer).toContain('!e.dead && hasPaladinWings');
    // ...read through the one death hold, against the wings the body showed the frame before
    expect(renderer).toContain(
      'heldUntilCollapse(deathHeld, !e.dead && hasPaladinWings, !!v.paladinAvengingWrathVisual),',
    );
  });

  it('keeps the wings on a body killed by a blade still in the air, until it collapses', () => {
    // The sim strips the wing aura on the tick the paladin dies (every buff goes:
    // src/sim/resurrection.ts aurasSurvivingDeath), so the live read is false on the first
    // held frame. The renderer's wing line, on the real wing module:
    const parent = new THREE.Group();
    const queue = new ContactQueue();
    const PALADIN = 3;
    let wings: PaladinAvengingWrathVisual | null = null;
    const frame = (now: number, live: { dead: boolean; hasPaladinWings: boolean }) => {
      queue.tick(now);
      const deathHeld = live.dead && queue.holdsDeath(PALADIN);
      wings = syncPaladinAvengingWrathVisual(
        wings,
        parent,
        1.8,
        heldUntilCollapse(deathHeld, !live.dead && live.hasPaladinWings, !!wings),
        1 / 60,
        false,
      );
      return wings;
    };
    const spread = frame(984, { dead: false, hasPaladinWings: true });
    expect(spread).not.toBeNull();
    const dispose = vi.spyOn((spread as PaladinAvengingWrathVisual).material, 'dispose');
    queue.note({}, 0.4, PALADIN, 1000);
    const killed = { dead: true, hasPaladinWings: false };
    let beat = (spread as PaladinAvengingWrathVisual).elapsed;
    for (const now of [1000, 1016, 1399]) {
      // the same wings, still on the body...
      expect(frame(now, killed), `held at ${now}`).toBe(spread);
      expect(parent.getObjectByName('paladin-avenging-wrath')).toBeDefined();
      // ...and still beating: the sync keeps driving them, it does not merely skip the dispose
      const elapsed = (spread as PaladinAvengingWrathVisual).elapsed;
      expect(elapsed, `held at ${now}`).toBeGreaterThan(beat);
      beat = elapsed;
    }
    expect(dispose).not.toHaveBeenCalled();
    // the blade lands: the wings go with the collapse
    expect(frame(1400, killed)).toBeNull();
    expect(parent.getObjectByName('paladin-avenging-wrath')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    // a paladin killed with no blade in the air loses them on the event, as before
    wings = null;
    const second = frame(2000, { dead: false, hasPaladinWings: true });
    expect(second).not.toBeNull();
    expect(frame(2016, killed)).toBeNull();
    // and a held body that wore none grows none
    queue.note({}, 0.4, PALADIN, 3000);
    expect(frame(3016, killed)).toBeNull();
  });
});
