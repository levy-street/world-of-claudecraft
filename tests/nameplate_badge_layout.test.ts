import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The nameplate flair layout is static DOM structure built once in
// renderer.ts (the append order) plus two CSS rules in hud.css (the margins
// that put each badge on the correct side of the name). Neither is reachable
// from the pure nameplate_view core, so these source-scan guards pin the
// intended layout: (Discord avatar) Name (holder gem badge).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

function ruleBody(css: string, selector: string): string {
  const block = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  expect(block, `${selector} rule not found`).toBeTruthy();
  return block ? block[1] : '';
}

describe('nameplate badge layout', () => {
  it('appends the flair in Discord, name, holder-tier order', () => {
    const src = read('src/render/renderer.ts');
    const append = src.match(/np\.append\(([\s\S]*?)\);/);
    expect(append, 'np.append(...) call not found in renderer.ts').toBeTruthy();
    const args = (append ? append[1] : '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const discord = args.indexOf('discordEl');
    const name = args.indexOf('nameEl');
    const tier = args.indexOf('tierEl');
    expect(discord).toBeGreaterThanOrEqual(0);
    expect(name).toBeGreaterThan(discord); // Discord avatar sits left of the name
    expect(tier).toBeGreaterThan(name); // holder gem sits right of the name
  });

  it('styles the Discord avatar in hud.css (shared), not the index-only sheet', () => {
    // On both game entries (index.html and play.html) nameplates render, so the
    // avatar's sizing rule must be in the shared hud.css, never index.extra.css.
    expect(read('src/styles/hud.css')).toMatch(/\.np-discord\s*\{/);
    expect(read('src/styles/index.extra.css')).not.toMatch(/\.np-discord\s*\{/);
  });

  it('puts the avatar left of the name and the gem right of it via margins', () => {
    const hud = read('src/styles/hud.css');
    // Avatar is left of the name: gap goes on its right edge.
    const discord = ruleBody(hud, '.np-discord');
    expect(discord).toMatch(/margin-right:\s*3px/);
    expect(discord).not.toMatch(/margin-left:/);
    // Gem is right of the name: gap goes on its left edge.
    const tier = ruleBody(hud, '.np-tier');
    expect(tier).toMatch(/margin-left:\s*3px/);
    expect(tier).not.toMatch(/margin-right:/);
  });
});
