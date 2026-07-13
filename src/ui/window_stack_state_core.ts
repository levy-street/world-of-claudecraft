// Pure visibility decision for effects that are only safe or useful while two
// large HUD windows are simultaneously visible. Hud owns the DOM class toggle;
// this core keeps the compositor-layer lifetime independently testable.

export function stackedWindowsVisible(firstVisible: boolean, secondVisible: boolean): boolean {
  return firstVisible && secondVisible;
}
