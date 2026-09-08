/** Hunter hardware opens as its actual arming timer drains; roots close it. */
export function hunterJawAngle(armTime: number, armRemaining: number, caught = false): number {
  if (caught) return 1.23;
  const progress = armTime > 0 ? 1 - Math.max(0, Math.min(1, armRemaining / armTime)) : 1;
  const eased = progress * progress * (3 - 2 * progress);
  return 1.05 * (1 - eased);
}

export function hasHunterTrapRestraint(entity: {
  dead: boolean;
  auras: readonly { id: string; kind: string; remaining: number }[];
}): boolean {
  return (
    !entity.dead &&
    entity.auras.some(
      (aura) =>
        aura.remaining > 0 &&
        ((aura.id === 'frostjaw_trap_freeze' && aura.kind === 'root') ||
          (aura.id === 'frost_trap_freeze' && aura.kind === 'stun')),
    )
  );
}
