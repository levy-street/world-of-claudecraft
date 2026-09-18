// The one stepper control the quantity surfaces share: a unit pair (minus and
// plus, one unit) inside a big pair (a whole bag stack), minted around an
// existing number input. The picker rows (material_sources_dialog.ts) and the
// bank family's quantity prompt (bank_quantity_prompt.ts) both mount it, so
// the clamp, the bound-disabling and the button texts live in exactly one
// place; the rules themselves are quantity_step_core.ts. Every aria string
// arrives resolved (the caller is the render sink). Owns DOM (mints buttons,
// writes the input): registered in UI_DOM_MODULES.

import { formatNumber } from './i18n';
import {
  type QuantityStepBounds,
  quantityStepDisabled,
  steppedQuantity,
} from './quantity_step_core';

export type QuantityStepKind = 'bigDown' | 'unitDown' | 'unitUp' | 'bigUp';

export interface QuantityStepperOptions {
  input: HTMLInputElement;
  /** Re-read on every sync, so a bound that depends on other controls (the
   *  picker's shared headroom) is always current. */
  bounds: () => QuantityStepBounds;
  /** Units one press of the big pair moves (the item's bag stack size). */
  size: number;
  /** Resolved accessible names, one per button. */
  labels: Record<QuantityStepKind, string>;
  /** Class list every button carries after `btn`. */
  className: string;
  /** Extra class the big pair carries. */
  bigClassName?: string;
  /** Called after a press wrote a new value into the input. */
  onChange?: () => void;
  /** Per-button hook for data attributes the owning surface's tests key on. */
  decorate?: (button: HTMLButtonElement, kind: QuantityStepKind) => void;
}

export interface QuantityStepper {
  readonly buttons: Record<QuantityStepKind, HTMLButtonElement>;
  /** Re-apply the disabled rule from the input's current value and bounds. */
  sync(): void;
}

/** Mint the four buttons and wire them to `input`. The caller places them
 *  (they are returned in reading order through `buttons`); nothing is appended
 *  here. The input's own `input` events re-sync the disabled state. */
export function mountQuantityStepper(opts: QuantityStepperOptions): QuantityStepper {
  const { input } = opts;
  const current = (): number => (input.value.trim() === '' ? Number.NaN : Number(input.value));
  const mint = (kind: QuantityStepKind, delta: number, text: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    const big = kind === 'bigDown' || kind === 'bigUp';
    button.className = `btn ${opts.className}${big && opts.bigClassName ? ` ${opts.bigClassName}` : ''}`;
    button.textContent = text;
    button.setAttribute('aria-label', opts.labels[kind]);
    button.addEventListener('click', () => {
      const value = current();
      const next = steppedQuantity(value, delta, opts.bounds());
      if (next === null || next === value) return;
      input.value = String(next);
      sync();
      opts.onChange?.();
    });
    opts.decorate?.(button, kind);
    return button;
  };
  const signed = (n: number): string =>
    formatNumber(n, { signDisplay: 'always', maximumFractionDigits: 0 });
  const buttons: Record<QuantityStepKind, HTMLButtonElement> = {
    bigDown: mint('bigDown', -opts.size, signed(-opts.size)),
    unitDown: mint('unitDown', -1, '−'),
    unitUp: mint('unitUp', 1, '+'),
    bigUp: mint('bigUp', opts.size, signed(opts.size)),
  };
  const sync = (): void => {
    const disabled = quantityStepDisabled(current(), opts.bounds());
    buttons.bigDown.disabled = disabled.down;
    buttons.unitDown.disabled = disabled.down;
    buttons.unitUp.disabled = disabled.up;
    buttons.bigUp.disabled = disabled.up;
  };
  input.addEventListener('input', sync);
  sync();
  return { buttons, sync };
}
