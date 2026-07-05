import { apiUrl, NATIVE_APP } from './online';

export interface NativeAttestationProof {
  platform: 'android' | 'ios';
  challengeId: string;
  token: string;
}

interface ChallengeResponse {
  challengeId?: unknown;
  nonce?: unknown;
}

interface NativeAttestationPlugin {
  getToken(opts: { nonce: string }): Promise<{ platform?: unknown; token?: unknown }>;
}

function nativePlugin(): NativeAttestationPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = cap?.Plugins?.NativeAttestation;
  if (!plugin || typeof plugin !== 'object') return null;
  const candidate = plugin as Partial<NativeAttestationPlugin>;
  return typeof candidate.getToken === 'function' ? candidate as NativeAttestationPlugin : null;
}

export async function createNativeAttestationProof(base: string, action: string): Promise<NativeAttestationProof | null> {
  if (!NATIVE_APP) return null;
  const plugin = nativePlugin();
  if (!plugin) return null;
  const challengeRes = await fetch(apiUrl('/api/native-attestation/challenge', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!challengeRes.ok) return null;
  const challenge = await challengeRes.json().catch(() => null) as ChallengeResponse | null;
  if (typeof challenge?.challengeId !== 'string' || typeof challenge.nonce !== 'string') return null;
  const token = await plugin.getToken({ nonce: challenge.nonce });
  if ((token.platform !== 'android' && token.platform !== 'ios') || typeof token.token !== 'string') return null;
  return {
    platform: token.platform,
    challengeId: challenge.challengeId,
    token: token.token,
  };
}
