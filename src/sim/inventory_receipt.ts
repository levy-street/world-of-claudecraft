import type { InventoryGrantOptions } from './inventory_grant';
import type { SimContext } from './sim_context';
import { cloneItemInstancePayload, type ItemInstancePayload } from './types';

/** Shared receipt for both grant hubs. Enhanced copies carry exact tooltip identity.
 * Keep absent optional keys absent: the deterministic event trace preserves them.
 */
export function emitInventoryReceipt(
  ctx: Pick<SimContext, 'emit'>,
  pid: number,
  itemId: string,
  itemName: string,
  count: number,
  opts?: InventoryGrantOptions,
  instance?: ItemInstancePayload,
): void {
  ctx.emit({
    type: 'loot',
    // biome-ignore lint/style/useTemplate: keep this scanner-friendly shape for i18n extraction.
    text: `You receive: ${itemName}${count > 1 ? ' x' + count : ''}.`,
    pid,
    ...(opts?.silent ? { silent: true } : {}),
    ...(opts?.callerLogs ? { callerLogs: true } : {}),
    ...(instance?.lootQuality
      ? { itemId, instance: cloneItemInstancePayload(instance), count }
      : {}),
  });
}
