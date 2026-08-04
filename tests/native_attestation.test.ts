import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  androidAppIntegrityAllowed,
  createNativeAttestationChallenge,
  nativeAttestationRequired,
  verifyNativeAttestation,
  verifyNativeAttestationChallenge,
  verifySeekerSolanaArtifactAttestation,
} from '../server/native_attestation';

const originalEnv = { ...process.env };

function req(headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: '203.0.113.10' },
  } as unknown as IncomingMessage;
}

interface SeekerArtifactPayload {
  requestDetails: {
    nonce: string;
    requestPackageName: string;
  };
  appIntegrity: {
    packageName: string;
    appRecognitionVerdict: string;
    certificateSha256Digest: string[];
  };
  deviceIntegrity: {
    deviceRecognitionVerdict?: string[];
  };
}

const seekerArtifactEnv = {
  SEEKER_SOLANA_INTEGRITY_PACKAGE_NAME: 'com.worldofclaudecraft',
  SEEKER_SOLANA_INTEGRITY_CERT_DIGESTS: 'solana-release-cert',
};

const enforcedAndroidAuthEnv = {
  NODE_ENV: 'production',
  NATIVE_ATTESTATION_REQUIRED: '1',
  GOOGLE_PLAY_INTEGRITY_PACKAGE_NAME: 'com.worldofclaudecraft',
  GOOGLE_PLAY_INTEGRITY_CERT_DIGESTS: 'google-play-signing-cert',
  SEEKER_SOLANA_INTEGRITY_PACKAGE_NAME: 'com.worldofclaudecraft',
  SEEKER_SOLANA_INTEGRITY_CERT_DIGESTS: 'solana-release-cert',
};

function validSeekerArtifactPayload(nonce: string): SeekerArtifactPayload {
  return {
    requestDetails: {
      nonce,
      requestPackageName: 'com.worldofclaudecraft',
    },
    appIntegrity: {
      packageName: 'com.worldofclaudecraft',
      appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
      certificateSha256Digest: ['solana-release-cert'],
    },
    deviceIntegrity: {
      deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
    },
  };
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

  it.each(['login', 'register'] as const)(
    'accepts an allowlisted Solana Store artifact for enforced native %s',
    async (action) => {
      const request = req({ origin: 'capacitor://localhost' });
      const challenge = createNativeAttestationChallenge(request, action);
      const payload = validSeekerArtifactPayload(challenge.nonce);

      await expect(
        verifyNativeAttestation(
          request,
          {
            platform: 'android',
            challengeId: challenge.challengeId,
            token: 'integrity-token',
          },
          {
            decodeIntegrityToken: async () => payload,
            env: enforcedAndroidAuthEnv,
          },
        ),
      ).resolves.toBe(true);
    },
  );

  it('continues to accept a Google Play recognised artifact for enforced native login', async () => {
    const request = req({ origin: 'capacitor://localhost' });
    const challenge = createNativeAttestationChallenge(request, 'login');
    const payload = validSeekerArtifactPayload(challenge.nonce);
    payload.appIntegrity.appRecognitionVerdict = 'PLAY_RECOGNIZED';
    payload.appIntegrity.certificateSha256Digest = ['google-play-signing-cert'];

    await expect(
      verifyNativeAttestation(
        request,
        {
          platform: 'android',
          challengeId: challenge.challengeId,
          token: 'integrity-token',
        },
        {
          decodeIntegrityToken: async () => payload,
          env: enforcedAndroidAuthEnv,
        },
      ),
    ).resolves.toBe(true);
  });

  const invalidNativeLoginArtifactCases: Array<{
    name: string;
    mutate(payload: SeekerArtifactPayload, env: NodeJS.ProcessEnv): void;
  }> = [
    {
      name: 'missing Solana certificate allowlist',
      mutate: (_payload, env) => {
        delete env.SEEKER_SOLANA_INTEGRITY_CERT_DIGESTS;
      },
    },
    {
      name: 'Google Play certificate on an unrecognised build',
      mutate: (payload) => {
        payload.appIntegrity.certificateSha256Digest = ['google-play-signing-cert'];
      },
    },
    {
      name: 'unknown certificate',
      mutate: (payload) => {
        payload.appIntegrity.certificateSha256Digest = ['attacker-cert'];
      },
    },
    {
      name: 'Solana package configuration mismatch',
      mutate: (_payload, env) => {
        env.SEEKER_SOLANA_INTEGRITY_PACKAGE_NAME = 'com.example.attacker';
      },
    },
    {
      name: 'missing required device verdict',
      mutate: (payload) => {
        delete payload.deviceIntegrity.deviceRecognitionVerdict;
      },
    },
  ];

  it.each(invalidNativeLoginArtifactCases)(
    'rejects an unrecognised native login artifact with $name',
    async ({ mutate }) => {
      const request = req({ origin: 'capacitor://localhost' });
      const challenge = createNativeAttestationChallenge(request, 'login');
      const payload = validSeekerArtifactPayload(challenge.nonce);
      const env = { ...enforcedAndroidAuthEnv };
      mutate(payload, env);

      await expect(
        verifyNativeAttestation(
          request,
          {
            platform: 'android',
            challengeId: challenge.challengeId,
            token: 'integrity-token',
          },
          {
            decodeIntegrityToken: async () => payload,
            env,
          },
        ),
      ).resolves.toBe(false);
    },
  );

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

  it('accepts a non-Play Seeker build only with an explicitly trusted certificate', () => {
    const dappStoreVerdict = {
      appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
      certificateSha256Digest: ['release-cert'],
    };
    expect(androidAppIntegrityAllowed(dappStoreVerdict, ['release-cert'], true)).toBe(true);
    expect(androidAppIntegrityAllowed(dappStoreVerdict, [], true)).toBe(false);
    expect(androidAppIntegrityAllowed(dappStoreVerdict, ['attacker-cert'], true)).toBe(false);
    expect(androidAppIntegrityAllowed(dappStoreVerdict, ['release-cert'], false)).toBe(false);
  });

  it('accepts only the configured Solana artifact, Android platform, nonce, and action', async () => {
    const request = req({ origin: 'capacitor://localhost' });
    const env = {
      SEEKER_SOLANA_INTEGRITY_PACKAGE_NAME: 'com.worldofclaudecraft',
      SEEKER_SOLANA_INTEGRITY_CERT_DIGESTS: 'solana-release-cert',
    };
    const challenge = createNativeAttestationChallenge(request, 'seeker-claim');
    const decodeIntegrityToken = async () => ({
      requestDetails: {
        nonce: challenge.nonce,
        requestPackageName: 'com.worldofclaudecraft',
      },
      appIntegrity: {
        packageName: 'com.worldofclaudecraft',
        appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
        certificateSha256Digest: ['solana-release-cert'],
      },
      deviceIntegrity: {
        deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
      },
    });

    await expect(
      verifySeekerSolanaArtifactAttestation(
        request,
        {
          platform: 'android',
          challengeId: challenge.challengeId,
          token: 'integrity-token',
        },
        'seeker-claim',
        { decodeIntegrityToken, env },
      ),
    ).resolves.toEqual({ nonce: challenge.nonce });

    const iosChallenge = createNativeAttestationChallenge(request, 'seeker-claim');
    await expect(
      verifySeekerSolanaArtifactAttestation(
        request,
        {
          platform: 'ios',
          challengeId: iosChallenge.challengeId,
          token: 'device-check-token',
        },
        'seeker-claim',
        { decodeIntegrityToken, env },
      ),
    ).resolves.toBeNull();

    const wrongAction = createNativeAttestationChallenge(request, 'seeker-claim');
    await expect(
      verifySeekerSolanaArtifactAttestation(
        request,
        {
          platform: 'android',
          challengeId: wrongAction.challengeId,
          token: 'integrity-token',
        },
        'seeker-spin',
        { decodeIntegrityToken, env },
      ),
    ).resolves.toBeNull();
  });

  const invalidArtifactCases: Array<{
    name: string;
    mutate(payload: SeekerArtifactPayload): void;
  }> = [
    {
      name: 'nonce mismatch',
      mutate: (payload) => {
        payload.requestDetails.nonce = 'different-nonce';
      },
    },
    {
      name: 'request package mismatch',
      mutate: (payload) => {
        payload.requestDetails.requestPackageName = 'com.example.attacker';
      },
    },
    {
      name: 'app package mismatch',
      mutate: (payload) => {
        payload.appIntegrity.packageName = 'com.example.attacker';
      },
    },
    {
      name: 'certificate digest mismatch',
      mutate: (payload) => {
        payload.appIntegrity.certificateSha256Digest = ['attacker-cert'];
      },
    },
    {
      name: 'missing device verdict',
      mutate: (payload) => {
        delete payload.deviceIntegrity.deviceRecognitionVerdict;
      },
    },
    {
      name: 'wrong device verdict',
      mutate: (payload) => {
        payload.deviceIntegrity.deviceRecognitionVerdict = ['MEETS_BASIC_INTEGRITY'];
      },
    },
  ];

  it.each(invalidArtifactCases)('rejects a Solana artifact with $name', async ({ mutate }) => {
    const request = req({ origin: 'capacitor://localhost' });
    const challenge = createNativeAttestationChallenge(request, 'seeker-claim');
    const payload = validSeekerArtifactPayload(challenge.nonce);
    mutate(payload);

    await expect(
      verifySeekerSolanaArtifactAttestation(
        request,
        {
          platform: 'android',
          challengeId: challenge.challengeId,
          token: 'integrity-token',
        },
        'seeker-claim',
        {
          decodeIntegrityToken: async () => payload,
          env: seekerArtifactEnv,
        },
      ),
    ).resolves.toBeNull();
  });

  it('fails closed for missing Solana allowlists and rejects Play signing certificates', async () => {
    const request = req({ origin: 'http://localhost' });
    const challenge = createNativeAttestationChallenge(request, 'seeker-spin');
    const proof = {
      platform: 'android',
      challengeId: challenge.challengeId,
      token: 'integrity-token',
    };
    const decodeIntegrityToken = async () => ({
      requestDetails: {
        nonce: challenge.nonce,
        requestPackageName: 'com.worldofclaudecraft',
      },
      appIntegrity: {
        packageName: 'com.worldofclaudecraft',
        appRecognitionVerdict: 'PLAY_RECOGNIZED',
        certificateSha256Digest: ['google-play-signing-cert'],
      },
      deviceIntegrity: {
        deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
      },
    });

    await expect(
      verifySeekerSolanaArtifactAttestation(request, proof, 'seeker-spin', {
        decodeIntegrityToken,
        env: {
          SEEKER_SOLANA_INTEGRITY_PACKAGE_NAME: 'com.worldofclaudecraft',
        },
      }),
    ).resolves.toBeNull();

    const playChallenge = createNativeAttestationChallenge(request, 'seeker-spin');
    await expect(
      verifySeekerSolanaArtifactAttestation(
        request,
        { ...proof, challengeId: playChallenge.challengeId },
        'seeker-spin',
        {
          decodeIntegrityToken: async () => ({
            ...(await decodeIntegrityToken()),
            requestDetails: {
              nonce: playChallenge.nonce,
              requestPackageName: 'com.worldofclaudecraft',
            },
          }),
          env: {
            SEEKER_SOLANA_INTEGRITY_PACKAGE_NAME: 'com.worldofclaudecraft',
            SEEKER_SOLANA_INTEGRITY_CERT_DIGESTS: 'solana-release-cert',
          },
        },
      ),
    ).resolves.toBeNull();
  });
});
