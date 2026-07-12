// Keeps the --app-vw/--app-vh custom properties in sync with the viewport.
// Active touch gameplay uses stable small-viewport units so mobile browser
// toolbar animation and the software keyboard never resize the game world.
function stableTouchGameViewport(win: Window): boolean {
  const classes = win.document.body.classList;
  return classes.contains('game-active') && classes.contains('mobile-touch');
}

export function syncAppViewport(win: Window = window): void {
  const doc = win.document;
  const vv = win.visualViewport;
  if (stableTouchGameViewport(win)) {
    doc.documentElement.style.setProperty('--app-vw', '100svw');
    doc.documentElement.style.setProperty('--app-vh', '100svh');
    return;
  }
  const visualScale = vv?.scale ?? 1;
  // visualViewport dimensions are expressed inside the current page scale.
  // Normalize them back to layout CSS pixels before writing html/body's fixed
  // dimensions. Without this, a landscape-to-portrait rotation can feed the
  // landscape width back into --app-vw while the browser zooms the page down,
  // permanently trapping the portrait layout at the landscape scale.
  const visualWidth = (vv?.width ?? win.innerWidth) * visualScale;
  const visualHeight = (vv?.height ?? win.innerHeight) * visualScale;
  const width = Math.max(1, Math.round(visualWidth));
  const height = Math.max(1, Math.round(visualHeight));
  doc.documentElement.style.setProperty('--app-vw', `${width}px`);
  doc.documentElement.style.setProperty('--app-vh', `${height}px`);
}
