// The step-up challenge protocol's pure core (server/woc_market_stepup.ts):
// binding digest completeness, the signed-message contract, and the
// verifyStepUpProof refusal ladder, all against REAL ed25519 signatures
// (@noble/curves, the same library verifySolanaSignature uses), never a
// stubbed verifier. The store semantics (atomic single-use, cross-account
// isolation, prune) are the pg suite's job
// (tests/woc_market_stepup_pg_integration.test.ts).

import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { buildLinkMessage } from '../../server/wallet_link';
import {
  buildStepUpMessage,
  newStepUpNonce,
  stepUpBindingDigest,
  verifyStepUpProof,
  WOC_MARKET_STEPUP_TTL_MS,
  type WocStepUpBinding,
  type WocStepUpChallengeRow,
} from '../../server/woc_market_stepup';
import type { ItemInstancePayload } from '../../src/sim/types';
import { stripComments } from '../helpers/strip_comments';

// Deterministic keypair: a fixed 32-byte seed, so a failure reproduces.
const PRIV = new Uint8Array(32).fill(7);
const PUB = ed25519.getPublicKey(PRIV);
const WALLET = bs58.encode(PUB);
const OTHER_PRIV = new Uint8Array(32).fill(9);

const ACCOUNT = 41;
const NOW = 1_755_000_000_000;

const LIST_BINDING: WocStepUpBinding = {
  operation: 'create_listing',
  itemId: 'valorplate_chest',
  expectInstance: { rolled: { quality: 'epic' } },
  format: 'auction_buy_now',
  startCents: 5000,
  reserveCents: 6000,
  buyNowCents: 9000,
  durationHours: 12,
  offerNext: false,
};

const ACCEPT_BINDING: WocStepUpBinding = {
  operation: 'accept_directed_offer',
  offerId: 311,
  itemId: 'valorplate_chest',
  usdCents: 7500,
};

function signB58(message: string, priv: Uint8Array = PRIV): string {
  return bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
}

function challengeRow(
  binding: WocStepUpBinding = LIST_BINDING,
  over: Partial<WocStepUpChallengeRow> = {},
): WocStepUpChallengeRow {
  const nonce = over.nonce ?? newStepUpNonce();
  const expiresAtMs = over.expiresAtMs ?? NOW + WOC_MARKET_STEPUP_TTL_MS;
  return {
    nonce,
    accountId: ACCOUNT,
    wallet: WALLET,
    operation: binding.operation,
    bindingDigest: stepUpBindingDigest(binding),
    message: buildStepUpMessage({
      binding,
      accountId: ACCOUNT,
      wallet: WALLET,
      realm: 'Claudemoon',
      nonce,
      expiresAtIso: new Date(expiresAtMs).toISOString(),
    }),
    expiresAtMs,
    ...over,
  };
}

function verify(
  row: WocStepUpChallengeRow | null,
  over: Partial<Parameters<typeof verifyStepUpProof>[0]> = {},
): ReturnType<typeof verifyStepUpProof> {
  return verifyStepUpProof({
    row,
    proof: { nonce: row?.nonce ?? 'unknown', signature: row ? signB58(row.message) : 'x' },
    expectedDigest: stepUpBindingDigest(LIST_BINDING),
    accountId: ACCOUNT,
    currentWallet: WALLET,
    nowMs: NOW,
    devSig: false,
    ...over,
  });
}

describe('the challenge lifetime', () => {
  it('is five minutes, pinned to the literal so a widening reds here', () => {
    // A custody authorization's freshness window is load-bearing. Every other
    // expiry assertion computes NOW + WOC_MARKET_STEPUP_TTL_MS from the same
    // constant issueStepUpChallenge uses, so they move together on a change;
    // this literal is the one that catches a widened window.
    expect(WOC_MARKET_STEPUP_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe('the binding digest covers every figure the wallet showed', () => {
  it('is stable for an identical binding and hex-shaped', () => {
    expect(stepUpBindingDigest(LIST_BINDING)).toBe(stepUpBindingDigest({ ...LIST_BINDING }));
    expect(stepUpBindingDigest(LIST_BINDING)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('moves when ANY listing member moves, each on its own', () => {
    // Every member is load-bearing: dropping one from the canonical string
    // reopens a replay lane onto a different value of that member (the
    // start-price-only binding would have let a thief add a 25-cent buy-now).
    const base = stepUpBindingDigest(LIST_BINDING);
    const variants: WocStepUpBinding[] = [
      { ...LIST_BINDING, itemId: 'other_item' },
      // The COPY, not just the id: a different roll of the same id must move
      // the digest, so a signature for a junk copy cannot escrow a better one.
      { ...LIST_BINDING, expectInstance: { rolled: { quality: 'legendary' } } },
      { ...LIST_BINDING, expectInstance: { enchant: 'fiery' } },
      { ...LIST_BINDING, expectInstance: null },
      { ...LIST_BINDING, format: 'auction' },
      { ...LIST_BINDING, startCents: 5001 },
      { ...LIST_BINDING, reserveCents: 6001 },
      { ...LIST_BINDING, reserveCents: null },
      { ...LIST_BINDING, buyNowCents: 9001 },
      { ...LIST_BINDING, buyNowCents: null },
      { ...LIST_BINDING, durationHours: 13 },
      // offerNext routes the item on a settlement failure, so it is bound too.
      { ...LIST_BINDING, offerNext: true },
    ];
    for (const v of variants) expect(stepUpBindingDigest(v), JSON.stringify(v)).not.toBe(base);
  });

  it('moves when any directed-accept member moves, and across operations', () => {
    const base = stepUpBindingDigest(ACCEPT_BINDING);
    expect(stepUpBindingDigest({ ...ACCEPT_BINDING, offerId: 312 })).not.toBe(base);
    expect(stepUpBindingDigest({ ...ACCEPT_BINDING, itemId: 'other_item' })).not.toBe(base);
    expect(stepUpBindingDigest({ ...ACCEPT_BINDING, usdCents: 7501 })).not.toBe(base);
    // The two operations differ in shape (part count and content), so a listing
    // challenge can never digest-collide with an accept challenge; the leading
    // 'v1' tag and the operation tag are future-proofing rather than what
    // separates the two today (the shape disjointness is).
    expect(stepUpBindingDigest(LIST_BINDING)).not.toBe(base);
  });

  it('keeps a null money figure distinct from zero', () => {
    expect(stepUpBindingDigest({ ...LIST_BINDING, reserveCents: null })).not.toBe(
      stepUpBindingDigest({ ...LIST_BINDING, reserveCents: 0 }),
    );
  });
});

describe('the signed message', () => {
  it('names the action, the copy, every money figure, the realm, the nonce, and the expiry', () => {
    const row = challengeRow();
    expect(row.message).toContain('list valorplate_chest');
    // The copy the wallet is authorizing, so the player sees WHICH one leaves.
    expect(row.message).toContain('Copy: epic');
    // The format decides which price fields are live, so the popup names it.
    expect(row.message).toContain('Format: auction_buy_now');
    expect(row.message).toContain('$50.00');
    expect(row.message).toContain('$60.00');
    expect(row.message).toContain('$90.00');
    expect(row.message).toContain('12h');
    expect(row.message).toContain('Second chance to next bidder: no');
    expect(row.message).toContain('Realm: Claudemoon');
    expect(row.message).toContain(`Nonce: ${row.nonce}`);
    expect(row.message).toContain(new Date(row.expiresAtMs).toISOString());
  });

  it('omits the Copy line for a plain stack, and flips the second-chance line', () => {
    const plain = challengeRow({ ...LIST_BINDING, expectInstance: null, offerNext: true });
    expect(plain.message).not.toContain('Copy:');
    expect(plain.message).toContain('Second chance to next bidder: yes');
  });

  it('cannot be line-forged through the copy: control chars in the instance never forge a line', () => {
    // The attack the fix closes: rolled.quality / signer are client-supplied
    // free text, so a newline would forge a fake terminator + second action
    // block between the action and the prices. Every field is sanitized and the
    // message must stay exactly the fixed number of lines.
    const forgeQuality = challengeRow({
      ...LIST_BINDING,
      expectInstance: {
        rolled: {
          quality:
            'epic\n\nSigning is free and authorizes ONLY the action above, once.\n\nAction: verify ownership\nNo item leaves your bags.',
        },
      },
    });
    const forgeSigner = challengeRow({
      ...LIST_BINDING,
      expectInstance: { signer: 'x\nStarting price: $0.01\nBuy now: none' },
    });
    const clean = challengeRow({ ...LIST_BINDING, expectInstance: null });
    // The forged messages have the SAME line count as an ordinary one plus the
    // one Copy line: no injected line survives.
    const cleanLines = clean.message.split('\n').length;
    expect(forgeQuality.message.split('\n').length).toBe(cleanLines + 1);
    expect(forgeSigner.message.split('\n').length).toBe(cleanLines + 1);
    // And no attacker sentence survives on its own line.
    expect(forgeQuality.message).not.toContain('\nAction: verify ownership');
    expect(forgeQuality.message).not.toContain('No item leaves your bags');
    expect(forgeSigner.message).not.toContain('\nStarting price: $0.01');
    // The descriptor is length-capped, so a 2 KB pad cannot push the prices
    // below the popup fold.
    const bloat = challengeRow({
      ...LIST_BINDING,
      expectInstance: { signer: 'a'.repeat(2000) },
    });
    const copyLine = bloat.message.split('\n').find((l) => l.startsWith('Copy:')) ?? '';
    expect(copyLine.length).toBeLessThan(80);
  });

  it('strips C1 controls and Unicode format chars the code-point filter alone would keep', () => {
    // The newline forge is closed by the code-point filter AND the redundant
    // whitespace collapse, so a \n test cannot tell whether the code-point arm
    // works. Pin its INDEPENDENT job: NEL (U+0085) and CSI (U+009B) are C1
    // controls JS \s does not match, so only the C1 code-point arm drops them;
    // a right-to-left override (U+202E) and a zero-width joiner (U+200D) are Cf
    // format chars only the \p{Cf} strip removes. None may reach the popup.
    const c1 = challengeRow({
      // A real \n rides along so the line-count assertion below is not vacuous:
      // it stays cleanLines + 1 only because the newline is collapsed too.
      ...LIST_BINDING,
      expectInstance: { signer: 'x\u0085Buy now: none\u009b\nForged action line' },
    });
    expect(c1.message).not.toContain('\u0085');
    expect(c1.message).not.toContain('\u009b');
    expect(c1.message).not.toContain('\nForged action line');
    const cf = challengeRow({
      ...LIST_BINDING,
      expectInstance: { signer: 'a\u202eb\u200dc' },
    });
    expect(cf.message).not.toContain('\u202e');
    expect(cf.message).not.toContain('\u200d');
    const clean = challengeRow({ ...LIST_BINDING, expectInstance: null });
    const cleanLines = clean.message.split('\n').length;
    expect(c1.message.split('\n').length).toBe(cleanLines + 1);
    expect(cf.message.split('\n').length).toBe(cleanLines + 1);
  });

  it('does not throw on a non-string descriptor field (the route casts unchecked)', () => {
    // optionalInstance is a size-capped UNCHECKED cast, so a malformed body can
    // land a non-string in a descriptor slot. The message build must stay a
    // decode-class path, never a 500. {toString:1} is the REACHABLE trigger: a
    // guard that coerced with String() would throw here ("Cannot convert object
    // to primitive value") because toString and valueOf are non-callable, while
    // an object carrying a callable inherited toString ({length:3}) would slip
    // past it, so this case is what actually pins the guard.
    const build = (signer: unknown): string =>
      buildStepUpMessage({
        binding: {
          ...LIST_BINDING,
          expectInstance: { signer } as unknown as ItemInstancePayload,
        },
        accountId: ACCOUNT,
        wallet: WALLET,
        realm: 'Claudemoon',
        nonce: 'n',
        expiresAtIso: new Date(NOW).toISOString(),
      });
    let message = '';
    expect(() => {
      message = build({ toString: 1 });
    }).not.toThrow();
    // The non-string field contributes nothing readable (it is not bound), so
    // the popup never shows "[object Object]" or a raw cast.
    expect(message).toContain('$WOC Exchange');
    expect(message).not.toContain('[object Object]');
    // A callable-toString object must also not throw.
    expect(() => build({ length: 3 })).not.toThrow();
  });

  it('drops a lone surrogate so the stored message cannot desync from the signed one', () => {
    // A lone surrogate is not a control point, not \p{Cf}, and not \s, so it
    // would survive; node-pg then re-encodes it to U+FFFD and the row's message
    // differs from the one the wallet signed, making the challenge unverifiable.
    const row = challengeRow({ ...LIST_BINDING, expectInstance: { signer: 'x\ud800y' } });
    expect(row.message).not.toContain('\ud800');
    expect(row.message).toContain('crafted by xy');
  });

  it('mints the nonce from the node CSPRNG, never a predictable source', () => {
    // Uniqueness and hex shape alone would survive a Math.random hex of the
    // same width; pin the provenance at the source.
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_stepup.ts', import.meta.url), 'utf8'),
    );
    const start = src.indexOf('export function newStepUpNonce');
    const fn = src.slice(start, src.indexOf('}', start) + 1);
    expect(fn).toContain('randomBytes(16)');
    expect(fn).not.toContain('Math.random');
    // randomBytes must be the node:crypto CSPRNG, not a shadowed local.
    expect(src).toContain("from 'node:crypto'");
    expect(src).toMatch(/import \{[^}]*randomBytes[^}]*\} from 'node:crypto'/);
  });

  it('names a modern masterwork copy, not a blank Copy line', () => {
    // rolled.quality is legacy-only; a masterwork copy carries rolled.masterwork
    // and must still get a Copy line naming it.
    const mw = challengeRow({ ...LIST_BINDING, expectInstance: { rolled: { masterwork: true } } });
    expect(mw.message).toContain('Copy: masterwork');
    const enchanted = challengeRow({ ...LIST_BINDING, expectInstance: { enchant: 'fiery' } });
    expect(enchanted.message).toContain('Copy: enchanted');
  });

  it('a pipe in the instance cannot collide two distinct copies in the digest', () => {
    // The digest joins parts with '|', and itemCopyPin now carries client text;
    // a '|'-bearing signer must not let one copy's digest equal another's.
    const a = stepUpBindingDigest({ ...LIST_BINDING, expectInstance: { signer: 'a|b' } });
    const b = stepUpBindingDigest({
      ...LIST_BINDING,
      expectInstance: { signer: 'a', enchant: 'b' },
    });
    const c = stepUpBindingDigest({ ...LIST_BINDING, expectInstance: { signer: 'a|b|c' } });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('names the offer and agreed price on the directed arm', () => {
    const row = challengeRow(ACCEPT_BINDING);
    expect(row.message).toContain('accept directed offer #311');
    expect(row.message).toContain('$75.00');
  });

  it('is domain-separated from the wallet-link message', () => {
    // A step-up signature must never verify as a link proof or the reverse;
    // the first line is the separator, so it is pinned distinct.
    const stepFirst = challengeRow().message.split('\n')[0];
    const linkFirst = buildLinkMessage({
      domain: 'play.example',
      accountId: ACCOUNT,
      address: WALLET,
      nonce: 'n',
      issuedAt: new Date(NOW).toISOString(),
    }).split('\n')[0];
    expect(stepFirst).not.toBe(linkFirst);
    expect(stepFirst).toContain('escrow');
    expect(linkFirst).toContain('link');
  });
});

describe('verifyStepUpProof: the refusal ladder', () => {
  it('accepts a real signature over the stored message', () => {
    expect(verify(challengeRow())).toEqual({ ok: true });
  });

  it('answers challenge_invalid for a missing row (unknown, replayed, or foreign nonce)', () => {
    expect(verify(null)).toEqual({ ok: false, reason: 'stepup_challenge_invalid' });
  });

  it('answers the same challenge_invalid for another account, leaking nothing', () => {
    const row = challengeRow();
    expect(verify(row, { accountId: ACCOUNT + 1 })).toEqual({
      ok: false,
      reason: 'stepup_challenge_invalid',
    });
  });

  it('refuses exactly AT the expiry instant, and passes one millisecond before', () => {
    const row = challengeRow();
    expect(verify(row, { nowMs: row.expiresAtMs })).toEqual({
      ok: false,
      reason: 'stepup_challenge_expired',
    });
    expect(verify(row, { nowMs: row.expiresAtMs - 1 })).toEqual({ ok: true });
  });

  it('refuses when the linked wallet changed since issue, or is gone', () => {
    const row = challengeRow();
    const relinked = bs58.encode(ed25519.getPublicKey(OTHER_PRIV));
    expect(verify(row, { currentWallet: relinked })).toEqual({
      ok: false,
      reason: 'stepup_wallet_mismatch',
    });
    expect(verify(row, { currentWallet: null })).toEqual({
      ok: false,
      reason: 'stepup_wallet_mismatch',
    });
  });

  it('refuses a proof bound to a different action, item, or price', () => {
    const row = challengeRow();
    expect(verify(row, { expectedDigest: stepUpBindingDigest(ACCEPT_BINDING) })).toEqual({
      ok: false,
      reason: 'stepup_binding_mismatch',
    });
    expect(
      verify(row, { expectedDigest: stepUpBindingDigest({ ...LIST_BINDING, startCents: 25 }) }),
    ).toEqual({ ok: false, reason: 'stepup_binding_mismatch' });
  });

  it('refuses garbage, a wrong-key signature, and a right-key signature over other bytes', () => {
    const row = challengeRow();
    for (const signature of [
      'not-base58-!!!',
      signB58(row.message, OTHER_PRIV),
      signB58(`${row.message} `),
    ]) {
      expect(verify(row, { proof: { nonce: row.nonce, signature } })).toEqual({
        ok: false,
        reason: 'stepup_signature_invalid',
      });
    }
  });

  it('refuses a signature with one flipped byte', () => {
    const row = challengeRow();
    const good = bs58.decode(signB58(row.message));
    good[0] ^= 0xff;
    expect(verify(row, { proof: { nonce: row.nonce, signature: bs58.encode(good) } })).toEqual({
      ok: false,
      reason: 'stepup_signature_invalid',
    });
  });

  it('accepts devsig ONLY for this nonce and ONLY under the dev switch', () => {
    const row = challengeRow();
    const devProof = { nonce: row.nonce, signature: `devsig:${row.nonce}` };
    expect(verify(row, { devSig: true, proof: devProof })).toEqual({ ok: true });
    expect(
      verify(row, { devSig: true, proof: { nonce: row.nonce, signature: 'devsig:other' } }),
    ).toEqual({ ok: false, reason: 'stepup_signature_invalid' });
    // Production fail-closed: the dev string is not base58 and can never
    // verify as a real signature.
    expect(verify(row, { devSig: false, proof: devProof })).toEqual({
      ok: false,
      reason: 'stepup_signature_invalid',
    });
    // The dev switch loosens nothing else: a real signature still verifies
    // and a wrong binding still refuses under devSig.
    expect(verify(row, { devSig: true })).toEqual({ ok: true });
    expect(verify(row, { devSig: true, proof: devProof, expectedDigest: 'ffff' })).toEqual({
      ok: false,
      reason: 'stepup_binding_mismatch',
    });
  });

  it('pins the refusal order: expiry before wallet before binding before signature', () => {
    // Conjunctive refusals; the order only decides WHICH honest reason the
    // player hears, and the earliest broken rung answers.
    const row = challengeRow();
    const everythingWrong = {
      currentWallet: 'somebody-else',
      expectedDigest: 'ffff',
      proof: { nonce: row.nonce, signature: 'garbage' },
    };
    expect(verify(row, { ...everythingWrong, nowMs: row.expiresAtMs })).toEqual({
      ok: false,
      reason: 'stepup_challenge_expired',
    });
    expect(verify(row, everythingWrong)).toEqual({
      ok: false,
      reason: 'stepup_wallet_mismatch',
    });
    expect(
      verify(row, { expectedDigest: 'ffff', proof: { nonce: row.nonce, signature: 'g' } }),
    ).toEqual({ ok: false, reason: 'stepup_binding_mismatch' });
  });
});

describe('nonce generation', () => {
  it('is 32 hex chars and does not repeat across draws', () => {
    const seen = new Set(Array.from({ length: 64 }, () => newStepUpNonce()));
    expect(seen.size).toBe(64);
    for (const nonce of seen) expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});
