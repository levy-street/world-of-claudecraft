// Real owning Sim fixture shared by scoped ledger regression and local probes.
import { BUILTIN_WORLD } from '../../src/sim/data';
import { materialItemIds } from '../../src/sim/material_ids';
import { materialSourceKey } from '../../src/sim/material_sources';
import { normalizeMaterialStack } from '../../src/sim/material_stack';
import { sanitizeVaultState } from '../../src/sim/materials_vault';
import { type PlayerMeta, Sim } from '../../src/sim/sim';

export function vaultCommandFixture(maximal = false, prices?: readonly number[]) {
  const id = 'bursar_fernando';
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: false,
    storagePrices: prices ? { vaultUpgrades: prices } : undefined,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: { [id]: BUILTIN_WORLD.npcs[id] },
      groundObjects: [],
    },
  });
  const pid = sim.playerId;
  const meta = sim.meta(pid);
  const player = sim.entities.get(pid);
  const banker = sim.entities.get(sim.bankerIds[0]);
  if (!meta || !player || !banker) throw new Error('Missing vault fixture owner or banker');
  banker.pos = { ...player.pos };
  banker.prevPos = { ...banker.pos };
  meta.inventory = [];
  meta.bags = [null, null, null, null];
  meta.copper = 10_000_000;
  meta.vault = sanitizeVaultState({
    stock: {},
    upgrades: 10,
    special: maximal
      ? [...materialItemIds()].map((itemId) => ({
          itemId,
          count: 1000,
          materialSources: Array.from({ length: 1000 }, (_, i) => ({
            source: { gatherer: { kind: 'character', id: 2147483647 - i, name: 'W'.repeat(16) } },
            count: 1,
          })),
        }))
      : [],
  });
  return { sim, pid, meta, player, banker };
}

export function vaultCommandCustody(meta: Pick<PlayerMeta, 'vault' | 'inventory'>) {
  const counts = new Map<string, number>();
  const add = (key: string, n: number) => counts.set(key, (counts.get(key) ?? 0) + n);
  for (const [itemId, count] of Object.entries(meta.vault.stock))
    add(JSON.stringify([itemId, materialSourceKey({}), null, null]), count);
  for (const row of [...meta.inventory, ...meta.vault.special]) {
    const normalized = normalizeMaterialStack(row, materialItemIds());
    if (!normalized.ok) {
      add(
        JSON.stringify([
          row.itemId,
          materialSourceKey({}),
          row.instance ?? null,
          row.craftedRecipeId ?? null,
        ]),
        row.count,
      );
      continue;
    }
    const slot = normalized.value;
    for (const bucket of slot.materialSources ?? [{ source: {}, count: slot.count }])
      add(
        JSON.stringify([
          slot.itemId,
          materialSourceKey(bucket.source),
          slot.instance ?? null,
          slot.craftedRecipeId ?? null,
        ]),
        bucket.count,
      );
  }
  return [...counts.entries()].filter(([, n]) => n !== 0).sort(([a], [b]) => a.localeCompare(b));
}
