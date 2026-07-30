import crypto from 'node:crypto';

export const NATIVE_DISCORD_HANDOFF_TTL_MS = 5 * 60 * 1000;
const CODE_BYTES = 20;
const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type NativeDiscordHandoff =
  | { kind: 'login'; accountId: number; username: string }
  | { kind: 'choose'; linkToken: string; username: string };

interface StoredHandoff {
  payload: NativeDiscordHandoff;
  challenge: string;
  issuedAt: number;
}

const handoffs = new Map<string, StoredHandoff>();

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function prune(): void {
  const cutoff = Date.now() - NATIVE_DISCORD_HANDOFF_TTL_MS;
  for (const [code, entry] of handoffs) {
    if (entry.issuedAt < cutoff) handoffs.delete(code);
  }
}

export function validNativeDiscordChallenge(value: unknown): value is string {
  return typeof value === 'string' && PROOF_PATTERN.test(value);
}

export function createNativeDiscordHandoff(
  challenge: string,
  payload: NativeDiscordHandoff,
): string {
  if (!validNativeDiscordChallenge(challenge)) throw new Error('invalid native Discord challenge');
  prune();
  const code = crypto.randomBytes(CODE_BYTES).toString('base64url');
  handoffs.set(code, {
    payload,
    challenge,
    issuedAt: Date.now(),
  });
  return code;
}

export function consumeNativeDiscordHandoff(
  code: unknown,
  verifier: unknown,
): NativeDiscordHandoff | null {
  prune();
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(code)) return null;
  if (typeof verifier !== 'string' || !PROOF_PATTERN.test(verifier)) return null;
  const entry = handoffs.get(code);
  if (!entry) return null;
  if (Date.now() - entry.issuedAt > NATIVE_DISCORD_HANDOFF_TTL_MS) return null;
  const actual = Buffer.from(challengeFor(verifier));
  const expected = Buffer.from(entry.challenge);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  handoffs.delete(code);
  return entry.payload;
}

export function resetNativeDiscordHandoffsForTest(): void {
  handoffs.clear();
}
