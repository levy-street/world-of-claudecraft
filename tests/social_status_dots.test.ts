// #100 — the social presence dot is colored purely by a CSS class derived from
// the player's status ('online' | 'combat' | 'dungeon' | 'dead'). A regression
// once shipped where the green rule was named `.soc-dot.on` while the client
// emitted `soc-dot online`, so every online player showed a grey dot. This
// guards the JS<->CSS contract: every status the client can render must have a
// matching `.soc-dot.<status>` rule.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The social window CSS (the `.soc-dot.<status>` rules) moved out of index.html's
// inline <style> into src/styles/components.css, loaded by both game entries via the
// barrel. The JS<->CSS contract guarded below now reads the module.
const componentsCss = readFileSync(join(root, 'src/styles/components.css'), 'utf8');
// The social list rendering moved out of hud.ts into the social window painter,
// so the dot-class contract now lives there.
const socialWindow = readFileSync(join(root, 'src/ui/social_window.ts'), 'utf8');

// the online presence statuses the server sends and the client turns into a dot class
const ONLINE_STATUSES = ['online', 'combat', 'dungeon', 'dead'];

describe('social presence dot styling (#100)', () => {
  it('every online status has a matching .soc-dot CSS color rule', () => {
    for (const status of ONLINE_STATUSES) {
      expect(componentsCss, `missing CSS rule .soc-dot.${status}`).toContain(`.soc-dot.${status}`);
    }
  });

  it('the dead-but-stale .soc-dot.on rule (which never matched) is gone', () => {
    expect(componentsCss).not.toMatch(/\.soc-dot\.on\b/);
  });

  it('the client still renders the dot class from the status value (offline => no status class)', () => {
    // guards the source line that builds the class, so the contract above stays meaningful
    expect(socialWindow).toContain("=== 'off' ? '' :");
  });
});
