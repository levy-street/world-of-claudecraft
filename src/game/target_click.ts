// Ground-click target policy. A left-click on empty ground classically clears
// the current target; the opt-in stickyTarget setting keeps it instead, so
// click-to-move players can reposition without constantly losing their target.
// Only the clear is skipped: click-to-move and click feedback are untouched,
// and in sticky mode the target still drops by targeting something else, target
// death, or the usual range/stealth rules. Pure so main.ts stays a thin caller
// and the rule is unit-testable (tests/target_click.test.ts).

/** True when a click on empty ground should clear the player's target:
 *  a left-click (button 0) while sticky targeting is off. */
export function shouldClearTargetOnGroundClick(button: number, stickyTarget: boolean): boolean {
  return button === 0 && !stickyTarget;
}
