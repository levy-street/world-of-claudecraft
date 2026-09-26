/** Session-local entity slots. Never persist entity ids across world sessions. */
export class FocusTargetSlots {
  readonly ids: Array<number | null> = [null, null, null];

  assign(slot: number, id: number | null): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.ids.length) return false;
    this.ids[slot] = id;
    return true;
  }

  target(slot: number, exists: (id: number) => boolean): number | null {
    const id = this.ids[slot];
    return id !== null && id !== undefined && exists(id) ? id : null;
  }
}

export function focusTargetAction(action: string): { slot: number; assign: boolean } | null {
  const match = /^(set|target)Focus([1-3])$/.exec(action);
  return match ? { slot: Number(match[2]) - 1, assign: match[1] === 'set' } : null;
}
