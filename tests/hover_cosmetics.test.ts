// Hover cosmetics: catalog integrity, the sim apply command, and the shipped
// back-attachment GLBs (wings must carry the wing.l / wing.r halves the
// renderer flaps; see scripts/build_hover_attachments.mjs).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOVER_COSMETIC_LIST,
  HOVER_COSMETICS,
  isHoverCosmeticId,
} from '../src/sim/content/hover_cosmetics';
import { Sim } from '../src/sim/sim';

const ROOT = join(__dirname, '..');

function glbNodeNames(path: string): string[] {
  const glb = readFileSync(path);
  const jsonLen = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  return (doc.nodes ?? []).map((n: { name?: string }) => n.name ?? '');
}

describe('hover cosmetic catalog', () => {
  it('ships four cosmetics with ids as record keys', () => {
    expect(HOVER_COSMETIC_LIST.length).toBe(4);
    for (const [key, def] of Object.entries(HOVER_COSMETICS)) {
      expect(def.id).toBe(key);
    }
    expect(isHoverCosmeticId('butterfly_drift')).toBe(true);
    expect(isHoverCosmeticId('tinkers_jetpack')).toBe(true);
    expect(isHoverCosmeticId('not_a_thing')).toBe(false);
    expect(isHoverCosmeticId(null)).toBe(false);
    // Prototype-chain keys must not pass the gate (Object.hasOwn, never `in`).
    expect(isHoverCosmeticId('__proto__')).toBe(false);
    expect(isHoverCosmeticId('constructor')).toBe(false);
    expect(isHoverCosmeticId('toString')).toBe(false);
  });

  it('every cosmetic ships its back-attachment GLB; wings carry the flap halves', () => {
    for (const def of HOVER_COSMETIC_LIST) {
      const path = join(ROOT, `public/models/cosmetics/${def.model}.glb`);
      const nodes = glbNodeNames(path);
      if (def.flaps) {
        expect(nodes, `${def.model} left wing`).toContain('wing.l');
        expect(nodes, `${def.model} right wing`).toContain('wing.r');
      } else {
        expect(nodes, `${def.model} rigid core`).toContain('core');
      }
    }
  });
});

describe('sim hover apply (offline free-apply, like change_skin)', () => {
  it('applies a catalog cosmetic, clears with null, rejects junk', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', playerName: 'Hoverer' });
    const p = sim.entities.get(sim.primaryId);
    expect(p?.hoverCosmeticId).toBeNull();
    sim.changeHoverCosmetic('butterfly_drift');
    expect(p?.hoverCosmeticId).toBe('butterfly_drift');
    // The accountCosmetics view mirrors the applied cosmetic (store badge parity).
    expect(sim.accountCosmetics.hoverId).toBe('butterfly_drift');
    sim.changeHoverCosmetic('nonsense_id');
    expect(p?.hoverCosmeticId).toBe('butterfly_drift'); // junk rejected, state kept
    expect(sim.accountCosmetics.hoverId).toBe('butterfly_drift');
    sim.changeHoverCosmetic(null);
    expect(p?.hoverCosmeticId).toBeNull();
    expect(sim.accountCosmetics.hoverId).toBeNull();
  });

  it('setHoverCosmetic rejects non-player targets', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage', playerName: 'Hoverer' });
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob');
    if (mob) expect(sim.setHoverCosmetic(mob.id, 'butterfly_drift')).toBe(false);
  });
});
