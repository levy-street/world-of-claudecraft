// Stored enchant contributions remain intact while a Perfected-only enchant
// is dormant. Combat and presentation share this active-only projection;
// replacement still subtracts the full stored contribution exactly once.
import { ENCHANTS } from './content/enchants';
import type { ItemInstancePayload } from './types';

export function isItemEnchantActive(instance: ItemInstancePayload | undefined): boolean {
  const enchant = instance?.enchant ? ENCHANTS[instance.enchant] : undefined;
  return enchant?.requiresPerfected !== true || instance?.perfected === true;
}

export function activeItemInstanceStats(
  instance: ItemInstancePayload | undefined,
): Record<string, number> | undefined {
  const stored = instance?.rolled?.stats;
  if (!stored || isItemEnchantActive(instance)) return stored;
  const active = { ...stored };
  const enchant = ENCHANTS[instance!.enchant!];
  for (const [stat, value] of Object.entries(enchant.statBonus)) {
    const remain = (active[stat] ?? 0) - (value ?? 0);
    if (remain > 0) active[stat] = remain;
    else delete active[stat];
  }
  return active;
}
