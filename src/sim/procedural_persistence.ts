import {
  duplicateProceduralItemUids,
  type ProceduralUidContainers,
  sanitizeItemInstancePayload,
} from './procedural_item_validation';
import type { ItemInstancePayload } from './types';

export function sanitizePersistedItemInstance(
  value: unknown,
  expectedItemId: string,
  location: string,
): ItemInstancePayload {
  const result = sanitizeItemInstancePayload(value, expectedItemId);
  if (!result.ok) {
    throw new Error(`Invalid persisted item instance at ${location}: ${result.error}`);
  }
  return result.value;
}

export function assertUniqueProceduralItemUids(
  containers: ProceduralUidContainers,
  location = 'character state',
): void {
  const duplicates = duplicateProceduralItemUids(containers);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate procedural item UID in ${location}: ${duplicates.join(', ')}`);
  }
}

export function assertProceduralUidAvailable(
  containers: ProceduralUidContainers,
  candidate: ItemInstancePayload,
): void {
  const uid = candidate.procedural?.uid;
  if (!uid) return;
  const duplicates = duplicateProceduralItemUids({
    ...containers,
    inventory: [
      ...(containers.inventory ?? []),
      { itemId: candidate.procedural?.baseId ?? '', count: 1, instance: candidate },
    ],
  });
  if (duplicates.includes(uid)) {
    throw new Error(`Duplicate procedural item UID at grant: ${uid}`);
  }
}

export function sanitizeProceduralGrant(
  itemId: string,
  instance: ItemInstancePayload,
): ItemInstancePayload {
  if (!instance.procedural) return instance;
  const result = sanitizeItemInstancePayload(instance, itemId);
  if (!result.ok) {
    throw new Error(`Invalid procedural item grant for ${itemId}: ${result.error}`);
  }
  return result.value;
}
