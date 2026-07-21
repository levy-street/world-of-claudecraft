import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createNativeDiscordProof,
  createNativeDiscordUrlDeduper,
  parseNativeDiscordUrl,
} from '../src/net/native_discord';

describe('native Discord OAuth deep link', () => {
  it('parses a returning login handoff', () => {
    expect(
      parseNativeDiscordUrl(
        'worldofclaudecraft://discord-auth?ok=1&mode=login&code=abc_123&username=Player',
      ),
    ).toEqual({
      ok: true,
      mode: 'login',
      code: 'abc_123',
      username: 'Player',
      error: '',
    });
  });

  it('registers the callback on both native platforms', () => {
    const ios = readFileSync('ios/App/App/Info.plist', 'utf8');
    const android = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    expect(ios).toContain('<string>worldofclaudecraft</string>');
    expect(android).toContain('android:scheme="worldofclaudecraft"');
    expect(android).toContain('android:host="discord-auth"');
  });

  it('creates a verifier and matching SHA-256 challenge', async () => {
    const proof = await createNativeDiscordProof();
    expect(proof.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof.verifier));
    const expected = Buffer.from(digest).toString('base64url');
    expect(proof.challenge).toBe(expected);
  });

  it('deduplicates immediate duplicate delivery but permits a later identical relink', () => {
    let now = 100;
    const shouldHandle = createNativeDiscordUrlDeduper(10_000, () => now);
    expect(shouldHandle('same')).toBe(true);
    expect(shouldHandle('same')).toBe(false);
    now += 10_001;
    expect(shouldHandle('same')).toBe(true);
  });

  it('rejects unrelated schemes, hosts, and modes', () => {
    expect(parseNativeDiscordUrl('https://worldofclaudecraft.com/discord-auth')).toBeNull();
    expect(parseNativeDiscordUrl('worldofclaudecraft://desktop-login?mode=login')).toBeNull();
    expect(parseNativeDiscordUrl('worldofclaudecraft://discord-auth?mode=nope')).toBeNull();
  });
});
