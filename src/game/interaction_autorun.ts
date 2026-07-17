export type InteractionOutcome = boolean | Promise<boolean>;

export interface AutorunInput {
  setAutorun(on: boolean): boolean;
  clearClickMove(): void;
  movementIntentVersion(): number;
}

export interface AutorunIndicator {
  syncAutorun(on: boolean): void;
}

/** Stop continuous autorun only after a world interaction actually fired. */
export function stopAutorunForInteraction(
  didInteract: InteractionOutcome,
  input: AutorunInput,
  indicator: AutorunIndicator,
): InteractionOutcome {
  const movementVersion = input.movementIntentVersion();
  const stop = (succeeded: boolean): boolean => {
    if (!succeeded || input.movementIntentVersion() !== movementVersion) return false;
    input.setAutorun(false);
    input.clearClickMove();
    indicator.syncAutorun(false);
    return true;
  };
  return typeof didInteract === 'boolean' ? stop(didInteract) : didInteract.then(stop, () => false);
}
