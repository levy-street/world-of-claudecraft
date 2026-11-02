// The mount point for the full-screen HUD overlay layers (the Cooldown Manager
// and the aura overlays). They live inside #ui, the HUD stacking context the
// Performance overlay (#perf-overlay) already sits in, so the window band
// (Hud.bringWindowToFront, z 50 to 89) and the Options scrim stack OVER them.
// Mounted on <body> instead, the layer formed its own root-level stacking
// context above #ui and painted over every open window (talents, bags, ...).
// Falls back to <body> on a host with no game UI shell (tests, editor).

export function hudOverlayHost(doc: Document): HTMLElement {
  return doc.getElementById('ui') ?? doc.body;
}
