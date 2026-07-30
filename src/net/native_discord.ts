import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

export interface NativeDiscordResult {
  ok: boolean;
  mode: 'login' | 'link';
  code: string;
  username: string;
  error: string;
}

export function parseNativeDiscordUrl(value: string): NativeDiscordResult | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'worldofclaudecraft:' || url.hostname !== 'discord-auth') return null;
  const mode = url.searchParams.get('mode');
  if (mode !== 'login' && mode !== 'link') return null;
  return {
    ok: url.searchParams.get('ok') === '1',
    mode,
    code: url.searchParams.get('code') ?? '',
    username: url.searchParams.get('username') ?? '',
    error: url.searchParams.get('error') ?? '',
  };
}

const VERIFIER_KEY = 'woc_native_discord_verifier';

function base64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createNativeDiscordProof(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export async function openNativeDiscordOAuth(url: string, verifier: string): Promise<void> {
  localStorage.setItem(VERIFIER_KEY, verifier);
  await Browser.open({ url });
}

export function takeNativeDiscordVerifier(): string {
  const verifier = localStorage.getItem(VERIFIER_KEY) ?? '';
  localStorage.removeItem(VERIFIER_KEY);
  return verifier;
}

export function createNativeDiscordUrlDeduper(
  windowMs = 10_000,
  now: () => number = Date.now,
): (url: string) => boolean {
  let lastUrl = '';
  let lastAt = 0;
  return (url: string): boolean => {
    const at = now();
    if (url === lastUrl && at - lastAt < windowMs) return false;
    lastUrl = url;
    lastAt = at;
    return true;
  };
}

export async function installNativeDiscordUrlHandler(
  onResult: (result: NativeDiscordResult) => void | Promise<void>,
): Promise<void> {
  const shouldHandle = createNativeDiscordUrlDeduper();
  const handle = async (value: string): Promise<void> => {
    const result = parseNativeDiscordUrl(value);
    if (!result) return;
    if (!shouldHandle(value)) return;
    try {
      await Browser.close();
    } catch {
      // Android Custom Tabs close automatically when the app deep link opens.
    }
    await onResult(result);
  };

  await App.addListener('appUrlOpen', ({ url }) => {
    void handle(url);
  });
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handle(launch.url);
}
