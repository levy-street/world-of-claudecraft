// Boots the palette lab's runtime and panel (`?palette=on`, dev builds only).
// Imported for its side effect by post.ts, the game renderer's composer, so the
// guide and editor pages (which reach gfx.ts and the shader arms, never the
// composer) never load the runtime. The runtime is a separate chunk fetched
// only in a lab session, and it waits for the live world (`window.__game`)
// before it touches anything.

import { paletteLabEnabled } from './palette_lab_flag';

if (paletteLabEnabled() && typeof document !== 'undefined') {
  void import('./palette_lab_runtime').then((m) => m.startPaletteLab());
}
