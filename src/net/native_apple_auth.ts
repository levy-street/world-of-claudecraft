import { registerPlugin } from '@capacitor/core';
import { createNativeAttestationProof } from './native_attestation';
import type { Api } from './online';

interface AppleCredential {
  identityToken: string;
  authorizationCode: string;
  email: string;
  displayName: string;
}

interface NativeAppleAuthPlugin {
  signIn(options: { nonce: string }): Promise<AppleCredential>;
}

const NativeAppleAuth = registerPlugin<NativeAppleAuthPlugin>('NativeAppleAuth');

export function isNativeIos(): boolean {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return capacitor?.getPlatform?.() === 'ios';
}

export function isAppleAuthorizationCancellation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'APPLE_CANCELED';
}

export async function signInWithNativeApple(
  api: Api,
): Promise<{ choose: boolean; linkToken: string; username: string }> {
  const proof = await createNativeAttestationProof(api.base, 'apple');
  if (!proof) throw new Error('native attestation unavailable');
  const credential = await NativeAppleAuth.signIn({ nonce: proof.nonce });
  return api.appleLogin(credential.identityToken, credential.displayName, proof);
}
