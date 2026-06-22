import { describe, expect, it } from 'vitest';
import { isNativeAppRequest, isWebClientRequest, webLoginEnforced } from '../server/web_login_guard';

const req = (headers: Record<string, string>) => ({ headers }) as any;

describe('web login guard (anti-bot)', () => {
  it('enforces in production, is off in dev/test, and honours REQUIRE_WEB_LOGIN', () => {
    expect(webLoginEnforced({ NODE_ENV: 'production' } as any)).toBe(true);
    expect(webLoginEnforced({ NODE_ENV: 'test' } as any)).toBe(false);
    expect(webLoginEnforced({ NODE_ENV: 'development' } as any)).toBe(false);
    expect(webLoginEnforced({ NODE_ENV: 'production', REQUIRE_WEB_LOGIN: '0' } as any)).toBe(false);
    expect(webLoginEnforced({ NODE_ENV: 'development', REQUIRE_WEB_LOGIN: '1' } as any)).toBe(true);
  });

  it('rejects requests with no Origin (curl / headless scripts / multibox)', () => {
    expect(isWebClientRequest(req({}))).toBe(false);
    expect(isWebClientRequest(req({ 'user-agent': 'Mozilla/5.0' }))).toBe(false); // spoofed UA, still no Origin
  });

  it('accepts a same-origin browser POST (Origin host matches Host / X-Forwarded-Host)', () => {
    expect(isWebClientRequest(req({ origin: 'https://play.example.com', host: 'play.example.com' }))).toBe(true);
    expect(
      isWebClientRequest(req({ origin: 'https://play.example.com', 'x-forwarded-host': 'play.example.com' })),
    ).toBe(true);
  });

  it('accepts an explicit WEB_ORIGINS allow-list entry and localhost dev', () => {
    expect(
      isWebClientRequest(req({ origin: 'https://play.example.com' }), { WEB_ORIGINS: 'https://play.example.com' } as any),
    ).toBe(true);
    expect(isWebClientRequest(req({ origin: 'http://localhost:5173', host: '127.0.0.1:8787' }))).toBe(true);
  });

  it('accepts Capacitor native app origins', () => {
    expect(isWebClientRequest(req({ origin: 'capacitor://localhost', host: 'worldofclaudecraft.com' }))).toBe(true);
    expect(isWebClientRequest(req({ origin: 'http://localhost', host: 'worldofclaudecraft.com' }))).toBe(true);
    expect(isWebClientRequest(req({ origin: 'https://localhost', host: 'worldofclaudecraft.com' }))).toBe(true);
  });

  it('identifies native app origins for Turnstile bypass', () => {
    expect(isNativeAppRequest(req({ origin: 'capacitor://localhost', host: 'worldofclaudecraft.com' }))).toBe(true);
    expect(isNativeAppRequest(req({ origin: 'http://localhost', host: 'worldofclaudecraft.com' }))).toBe(true);
    expect(isNativeAppRequest(req({ origin: 'https://localhost', host: 'worldofclaudecraft.com' }))).toBe(true);
    expect(isNativeAppRequest(req({ origin: 'https://worldofclaudecraft.com', host: 'worldofclaudecraft.com' }))).toBe(false);
    expect(isNativeAppRequest(req({ origin: 'https://evil.example.com', host: 'worldofclaudecraft.com' }))).toBe(false);
    expect(isNativeAppRequest(req({ host: 'worldofclaudecraft.com' }))).toBe(false);
  });

  it('rejects a foreign origin', () => {
    expect(isWebClientRequest(req({ origin: 'https://evil.example.com', host: 'play.example.com' }))).toBe(false);
  });
});
