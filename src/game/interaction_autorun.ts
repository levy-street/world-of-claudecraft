export interface AutorunInput {
  setAutorun(on: boolean): boolean;
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
  indicator.syncAutorun(false);
  return true;
}
