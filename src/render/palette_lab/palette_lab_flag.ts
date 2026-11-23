// Whether this session runs the palette lab (`?palette=on`): the dev tool that
// swaps a zone's whole colour look live (see ./CLAUDE.md). Read ONCE at module
// load, like the cel look: the lab's shader arms (the output grade's palette
// block, the sky dome's gradient) are compile-time, so a session without the
// flag builds the stock shaders byte for byte and pays nothing.
//
// Hosts without a location (Node, the headless env) always run stock.
//
// A LEAF on purpose: the shader arms (gfx.ts, post.ts, sky.ts, the grass)
// import it, and the guide and editor pages reach gfx.ts too, so it must
// never pull the runtime into their module graph. The runtime boots from
// palette_lab_boot.ts, which only the game's composer (post.ts) imports.

function readMode(): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get('palette');
}

function readFlag(): boolean {
  if (typeof location === 'undefined') return false;
  const mode = readMode();
  return mode !== 'off' && mode !== '0';
}

function readPanelFlag(): boolean {
  if (!import.meta.env.DEV) return false;
  const mode = readMode();
  return mode === 'on' || mode === '1';
}

const enabled = readFlag();
const panelEnabled = readPanelFlag();

/** True when the per-zone palette look runtime is active (on by default in browser, off via `?palette=off`). */
export function paletteLabEnabled(): boolean {
  return enabled;
}

/** True when `?palette=on` (or `=1`) opted this dev session into the interactive Palette Lab UI panel. */
export function paletteLabPanelEnabled(): boolean {
  return panelEnabled;
}
