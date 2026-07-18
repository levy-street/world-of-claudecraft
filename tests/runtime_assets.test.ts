import { describe, expect, it } from 'vitest';
import { resolvePublicAssetUrl } from '../src/runtime_assets';

describe('resolvePublicAssetUrl', () => {
  it('keeps the normal root build rooted at slash', () => {
    expect(resolvePublicAssetUrl('/audio/main-theme.mp3', '/')).toBe('/audio/main-theme.mp3');
    expect(resolvePublicAssetUrl('ui/skills/mage/fireball.webp', '/')).toBe(
      '/ui/skills/mage/fireball.webp',
    );
  });

  it('uses relative URLs for Glitch static build prefixes', () => {
    expect(resolvePublicAssetUrl('/assets/main.js', './')).toBe('./assets/main.js');
    expect(resolvePublicAssetUrl('/media/models/player.glb', './')).toBe(
      './media/models/player.glb',
    );
  });

  it('preserves URLs that are already externally or locally resolved', () => {
    expect(resolvePublicAssetUrl('https://cdn.example/game.png', './')).toBe(
      'https://cdn.example/game.png',
    );
    expect(resolvePublicAssetUrl('./ui/cursors/arrow.png', './')).toBe('./ui/cursors/arrow.png');
    expect(resolvePublicAssetUrl('../shared/icon.png', './')).toBe('../shared/icon.png');
  });
});
