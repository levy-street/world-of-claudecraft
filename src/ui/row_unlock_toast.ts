const ROW_UNLOCK_LEVELS = new Set<number>([5, 8, 11, 14, 17, 20]);

export function isTalentRowUnlockLevel(level: number): boolean {
  return ROW_UNLOCK_LEVELS.has(level);
}
