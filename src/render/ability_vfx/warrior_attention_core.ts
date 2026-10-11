/** Forced attention is shared by Warrior taunts. A cast or ordinary aggro
 * cannot prove it, and a late observer must use the remaining live state. */
export interface WarriorAttentionEntity {
  id: number;
  kind?: string;
  templateId?: string;
  dead?: boolean;
  hp?: number;
  forcedTargetId?: number | null;
  forcedTargetTimer?: number;
}
export function isLivingWarriorAttentionSource(e: WarriorAttentionEntity | undefined): boolean {
  return (
    !!e &&
    e.kind === 'player' &&
    e.templateId === 'warrior' &&
    e.dead !== true &&
    Number.isFinite(e.hp) &&
    e.hp! > 0
  );
}
export function warriorAttentionSource(e: WarriorAttentionEntity): number | null {
  return e.kind === 'mob' &&
    e.dead !== true &&
    Number.isFinite(e.hp) &&
    e.hp! > 0 &&
    Number.isFinite(e.forcedTargetTimer) &&
    e.forcedTargetTimer! > 0 &&
    Number.isSafeInteger(e.forcedTargetId) &&
    e.forcedTargetId! >= 0 &&
    e.forcedTargetId !== e.id
    ? e.forcedTargetId!
    : null;
}
/** Three authored sprite cels tighten once, then hold. They never spin like stun stars. */
export function warriorAttentionCel(remaining: number, reduced: boolean): number {
  if (reduced) return 2;
  const elapsed = Math.max(0, 3 - remaining);
  return elapsed < 0.1 ? 0 : elapsed < 0.2 ? 1 : 2;
}
