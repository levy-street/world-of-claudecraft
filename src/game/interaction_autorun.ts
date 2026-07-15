export interface AutorunInput {
  setAutorun(on: boolean): boolean;
  clearClickMove(): void;
}

export interface AutorunIndicator {
  syncAutorun(on: boolean): void;
}

/** Stop continuous autorun only after a world interaction actually fired. */
export function stopAutorunForInteraction(
  didInteract: boolean,
  input: AutorunInput,
  indicator: AutorunIndicator,
): boolean {
  if (!didInteract) return false;
  input.setAutorun(false);
  input.clearClickMove();
  indicator.syncAutorun(false);
  return true;
}
