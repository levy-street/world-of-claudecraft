import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

// Drives the authoritative loot roller (Sim.rollLoot) directly against the
// dungeon mob templates, the same way combat death does, to verify the
// Inventory 2.0 drops fire at roughly their configured rates — and do so
// deterministically (same seed ⇒ identical empirical rate).
function dropRate(mobId: string, itemId: string, seed = 1234, n = 20000): number {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Looter');
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(pid);
  const template = MOBS[mobId];
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
    (sim as unknown as { rollLoot: (m: unknown, meta: unknown) => void }).rollLoot(mob, meta);
    if (mob.loot?.items.some((s) => s.itemId === itemId)) hits++;
  }
  return hits / n;
}

describe('Inventory 2.0 dungeon drops', () => {
  // [mob, item, configured chance] — the per-kill marginal drop probability.
  const CASES: [string, string, number][] = [
    // Drowned dungeon (Sunken Bastion) trash/elite — single-item bonus groups.
    ['bastion_revenant', 'mistveil_cord', 0.06],
    ['tidebound_acolyte', 'mistveil_grips', 0.06],
    // Wyrm dungeon (Gravewyrm Sanctum) trash/elite — two-item partitioned groups.
    ['sanctum_drakonid', 'gravewyrm_mantle', 0.05],
    ['sanctum_drakonid', 'gravewyrm_gauntlets', 0.05],
    ['sanctum_boneguard', 'boundstone_helm', 0.04],
    ['sanctum_boneguard', 'boundstone_girdle', 0.04],
    // Korzul (final boss) — the three archetype epics share the korzul_bonus partition.
    ['korzul_the_gravewyrm', 'deathlords_dread_visage', 0.04],
    ['korzul_the_gravewyrm', 'necromancers_soulspire_mantle', 0.04],
    ['korzul_the_gravewyrm', 'wyrmshadow_talongrips', 0.04],
  ];

  for (const [mob, item, chance] of CASES) {
    it(`${mob} drops ${item} near ${(chance * 100).toFixed(0)}%`, () => {
      const rate = dropRate(mob, item);
      // Wide enough to never flake (~10σ at these n), tight enough to prove the
      // item drops at the intended rate — not 0, not 100%, not an adjacent slice.
      expect(rate).toBeGreaterThan(chance - 0.02);
      expect(rate).toBeLessThan(chance + 0.02);
    });
  }

  it('is deterministic — identical seed reproduces the exact empirical rate', () => {
    expect(dropRate('bastion_revenant', 'mistveil_cord', 7, 5000))
      .toBe(dropRate('bastion_revenant', 'mistveil_cord', 7, 5000));
  });

  it('does not leak items across dungeons (mistveil is drowned-only)', () => {
    expect(dropRate('sanctum_drakonid', 'mistveil_cord')).toBe(0);
    expect(dropRate('bastion_revenant', 'gravewyrm_mantle')).toBe(0);
  });
});
