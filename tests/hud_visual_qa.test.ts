import { describe, expect, it } from 'vitest';
import { hudVisualQaDesktop, hudVisualQaPartySize } from '../src/game/hud_visual_qa';

describe('hudVisualQaPartySize', () => {
  it('accepts only the supported party/raid screenshot sizes', () => {
    expect(hudVisualQaPartySize('?hudqa=3')).toBe(3);
    expect(hudVisualQaPartySize('?hudqa=5')).toBe(5);
    expect(hudVisualQaPartySize('?hudqa=10')).toBe(10);
    expect(hudVisualQaPartySize('?hudqa=4')).toBeNull();
    expect(hudVisualQaPartySize('')).toBeNull();
  });
});

describe('hudVisualQaDesktop', () => {
  it('enables the desktop capture override only when its query flag is present', () => {
    expect(hudVisualQaDesktop('?hudqa=10&hudqaDesktop')).toBe(true);
    expect(hudVisualQaDesktop('?hudqaDesktop=1')).toBe(true);
    expect(hudVisualQaDesktop('?hudqa=10')).toBe(false);
    expect(hudVisualQaDesktop('')).toBe(false);
  });
});
