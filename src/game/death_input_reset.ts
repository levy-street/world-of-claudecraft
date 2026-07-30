export function shouldClearAutorunOnDeath(wasDead: boolean, isDead: boolean): boolean {
  return !wasDead && isDead;
}
