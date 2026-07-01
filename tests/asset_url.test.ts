import { describe, expect, it } from 'vitest';
import { publicAssetUrl } from '../src/asset_url';
import { assetUrl } from '../src/render/assets/media';

describe('public asset urls', () => {
  it('prefixes root-relative public paths with Vite base', () => {
    expect(publicAssetUrl('/media/foo.glb', '/world-of-claudecraft/')).toBe(
      '/world-of-claudecraft/media/foo.glb',
    );
  });

  it('accepts bases without trailing slash', () => {
    expect(publicAssetUrl('audio/main-theme.mp3', '/game')).toBe('/game/audio/main-theme.mp3');
  });

  it('preserves relative base deployments', () => {
    expect(publicAssetUrl('/ui/emotes/emote-wave.png', './')).toBe('./ui/emotes/emote-wave.png');
  });

  it('preserves external and inline urls', () => {
    expect(publicAssetUrl('https://cdn.example.com/a.png', '/game/')).toBe(
      'https://cdn.example.com/a.png',
    );
    expect(publicAssetUrl('//cdn.example.com/a.png', '/game/')).toBe('//cdn.example.com/a.png');
    expect(publicAssetUrl('data:image/png;base64,abc', '/game/')).toBe('data:image/png;base64,abc');
    expect(publicAssetUrl('blob:https://example.com/abc', '/game/')).toBe(
      'blob:https://example.com/abc',
    );
  });

  it('resolves media loader dev paths against base', () => {
    expect(assetUrl('/models/player.glb', { base: '/world-of-claudecraft/', dev: true })).toBe(
      '/world-of-claudecraft/models/player.glb',
    );
  });

  it('resolves media loader fallback paths against base', () => {
    expect(
      assetUrl('/models/not-in-manifest.glb', { base: '/world-of-claudecraft/', dev: false }),
    ).toBe('/world-of-claudecraft/models/not-in-manifest.glb');
  });
});
