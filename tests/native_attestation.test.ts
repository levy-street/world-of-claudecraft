import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNativeAttestationChallenge,
  nativeAttestationRequired,
  verifyNativeAttestation,
  verifyNativeAttestationChallenge,
} from '../server/native_attestation';

const originalEnv = { ...process.env };

function req(headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: '203.0.113.10' },
  } as unknown as IncomingMessage;
}

describe('native attestation', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is opt-in until production enforcement is configured', () => {
    delete process.env.NATIVE_ATTESTATION_REQUIRED;
    process.env.NODE_ENV = 'development';
    expect(nativeAttestationRequired()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(nativeAttestationRequired()).toBe(true);
    process.env.NATIVE_ATTESTATION_REQUIRED = '0';
    expect(nativeAttestationRequired()).toBe(false);
    process.env.NATIVE_ATTESTATION_REQUIRED = '1';
    expect(nativeAttestationRequired()).toBe(true);
  });

  it('allows recognised native origins while enforcement is disabled', async () => {
    process.env.NATIVE_ATTESTATION_REQUIRED = '0';
    await expect(
      verifyNativeAttestation(req({ origin: 'capacitor://localhost' }), undefined),
    ).resolves.toBe(true);
    await expect(
      verifyNativeAttestation(req({ origin: 'http://localhost' }), undefined),
    ).resolves.toBe(true);
  });

  it('does not allow non-native origins through the native path', async () => {
    process.env.NATIVE_ATTESTATION_REQUIRED = '0';
    await expect(
      verifyNativeAttestation(req({ origin: 'https://worldofclaudecraft.com' }), undefined),
    ).resolves.toBe(false);
  });

  it('rejects missing or invalid proofs when enforcement is enabled', async () => {
    process.env.NATIVE_ATTESTATION_REQUIRED = '1';
    const request = req({ origin: 'capacitor://localhost' });
    await expect(verifyNativeAttestation(request, undefined)).resolves.toBe(false);
    const challenge = createNativeAttestationChallenge(request, 'login');
    await expect(
      verifyNativeAttestation(request, {
        platform: 'unknown',
        challengeId: challenge.challengeId,
        token: 'token',
      }),
    ).resolves.toBe(false);
  });

  it('returns only the consumed server nonce for the expected action', async () => {
    process.env.NATIVE_ATTESTATION_REQUIRED = '0';
    const request = req({ origin: 'capacitor://localhost' });
    const challenge = createNativeAttestationChallenge(request, 'apple');
    const proof = { platform: 'ios', challengeId: challenge.challengeId, token: 'dev-token' };
    await expect(verifyNativeAttestationChallenge(request, proof, 'discord')).resolves.toBeNull();
    const appleChallenge = createNativeAttestationChallenge(request, 'apple');
    const appleProof = {
      platform: 'ios',
      challengeId: appleChallenge.challengeId,
      token: 'dev-token',
    };
    await expect(verifyNativeAttestationChallenge(request, appleProof, 'apple')).resolves.toEqual({
      nonce: appleChallenge.nonce,
    });
    await expect(
      verifyNativeAttestationChallenge(request, appleProof, 'apple'),
    ).resolves.toBeNull();
  });
});
