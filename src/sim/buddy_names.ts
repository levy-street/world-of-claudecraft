// Character-local buddy nicknames, bounded by the active catalog and pet-name rules.
import { BUDDY_KEYS, type BuddyKey, normalizeBuddyKey } from './content/buddies';
import { buddyTemplateId } from './content/buddy_mobs';
import { cleanPetName } from './pet/pet_commands';
import type { SimContext } from './sim_context';

export type BuddyNames = Partial<Record<BuddyKey, string>>;

export function normalizeBuddyNames(raw: unknown): BuddyNames {
  const names: BuddyNames = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return names;
  for (const key of BUDDY_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = (raw as Record<string, unknown>)[key];
    const clean = typeof value === 'string' ? cleanPetName(value) : null;
    if (clean) names[key] = clean;
  }
  return names;
}

/** The entity id captured by the menu avoids a realm-wide follower lookup and
 * prevents a dialog opened before a swap from renaming the replacement buddy. */
export function renameBuddy(ctx: SimContext, pid: number, buddyId: number, name: string): boolean {
  const owner = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  const buddy = ctx.entities.get(buddyId);
  const key = normalizeBuddyKey(owner?.buddyKey);
  if (
    !meta ||
    !key ||
    !meta.buddies.owned.has(key) ||
    buddy?.kind !== 'mob' ||
    buddy.ownerId !== pid ||
    buddy.templateId !== buddyTemplateId(key)
  )
    return false;
  const clean = cleanPetName(name);
  if (!clean) {
    ctx.error(
      pid,
      'Pet name must be 2-16 letters/spaces/hyphen/apostrophe and start with a letter.',
    );
    return false;
  }
  meta.buddies.names[key] = clean;
  buddy.name = clean;
  return true;
}
