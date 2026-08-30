// Press-to-charge, release-to-fire pointer binding for empowered abilities,
// shared by the desktop action bar and the mobile ring. Extracted from hud.ts;
// the Hud passes narrow closures, never itself.

export interface EmpoweredHoldDeps {
  /** Bind mode owns clicks and holds on the bar; the hold must stand down. */
  bindModeActive(): boolean;
  /** The empowered ability id the resolved slot holds, or null. */
  empoweredAbilityIdForSlot(slot: number): string | null;
  /** True while another slot's charge is already held. */
  chargeActive(): boolean;
  pressSlot(slot: number): void;
  releaseSlot(slot: number): void;
  /** Swallow the compatibility click the release would otherwise double-fire. */
  suppressNextClick(): void;
}

export function bindEmpoweredActionHold(
  btn: HTMLButtonElement,
  resolveSlot: () => number,
  deps: EmpoweredHoldDeps,
): void {
  let heldPointer: number | null = null;
  let heldSlot: number | null = null;
  btn.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (deps.bindModeActive()) return;
    const slot = resolveSlot();
    if (!deps.empoweredAbilityIdForSlot(slot)) return;
    if (deps.chargeActive()) return;
    heldPointer = event.pointerId;
    heldSlot = slot;
    deps.pressSlot(slot);
    try {
      btn.setPointerCapture?.(event.pointerId);
    } catch {
      /* pointer already released */
    }
    event.preventDefault();
  });
  const release = (event: PointerEvent, suppressClick: boolean) => {
    if (heldPointer !== event.pointerId || heldSlot === null) return;
    const slot = heldSlot;
    heldPointer = null;
    heldSlot = null;
    deps.releaseSlot(slot);
    if (suppressClick) deps.suppressNextClick();
    event.preventDefault();
  };
  btn.addEventListener('pointerup', (event) => release(event, true));
  btn.addEventListener('pointercancel', (event) => release(event, false));
}
