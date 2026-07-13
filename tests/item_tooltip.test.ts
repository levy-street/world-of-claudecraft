import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { setLanguage } from '../src/ui/i18n';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

afterEach(() => setLanguage('en'));

describe('canonical item tooltip', () => {
  it('describes an elixir effect, value, and readable duration', async () => {
    const { Hud } = await import('../src/ui/hud');
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    const tooltip = hud as unknown as {
      itemTooltip(item: ItemDef, compare?: boolean): string;
    };

    setLanguage('en');
    const html = tooltip.itemTooltip(ITEMS.elixir_of_the_bear, false);
    expect(html).toContain('Increases Stamina by 12');
    expect(html).toContain('Duration: 15 minutes');
  }, 15_000);

  it('escapes markup characters before trusted tooltip HTML reaches the detail pane', async () => {
    const { Hud } = await import('../src/ui/hud');
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    const tooltip = hud as unknown as {
      itemTooltip(item: ItemDef, compare?: boolean): string;
    };
    const item: ItemDef = {
      id: '<img src=x onerror=alert(1)>',
      name: 'Unsafe test item',
      kind: 'junk',
      quality: 'common',
      sellValue: 0,
      buyValue: 0,
    };

    const html = tooltip.itemTooltip(item, false);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  }, 15_000);
});
