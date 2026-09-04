// The target frame's flair line, extracted out of Hud.updateTargetDiscordLine so
// its three decisions are drivable without a DOM.
//
// THE BUG THIS FILE EXISTS FOR. The signature used to digest tier, discordName,
// discordRole, discordAvatar, devIdx and isAi: all identity data a locale switch
// never moves. The rebuild it gates emits FOUR localized faces (the role tag, the
// rank rung, the dev rung, and the [AI] mark plus its screen-reader label). So
// after a language switch a flagged target's line stayed in the PREVIOUS locale
// until that player's flair happened to change, and nothing repainted it: the
// line has no fan-out arm, and hud.ts carries the blanket 'coordinator' opt-out
// that tests/language_fanout_registry.test.ts skips by name, so the guard could
// not report it either. The fix is to key the language into the signature.
//
// The decisive proof is here rather than in a source scan, and it is a
// DIFFERENCE across two languages with byte-identical identity data: a test
// asserting the signature merely CONTAINS the language would pass on a signature
// that appended a constant, and one asserting the field list would pass on a
// rename.

import { beforeEach, describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, getLanguage, setLanguage } from '../src/ui/i18n';
import {
  type TargetFlairLineInput,
  targetFlairLineHtml,
  targetFlairLineVisible,
  targetFlairSignature,
} from '../src/ui/target_flair_line_view';

function input(over: Partial<TargetFlairLineInput> = {}): TargetFlairLineInput {
  return {
    language: 'en',
    tier: 0,
    name: '',
    role: '',
    avatar: '',
    devIndex: 0,
    isAi: false,
    ...over,
  };
}

describe('targetFlairLineVisible', () => {
  it('hides a player with no flair of any kind', () => {
    expect(targetFlairLineVisible(input())).toBe(false);
  });

  it('shows on each flair channel on its own', () => {
    // Per DIMENSION, not one composite case: a predicate that had dropped any
    // single arm would still pass a test that only ever sets them together.
    expect(targetFlairLineVisible(input({ tier: 1 }))).toBe(true);
    expect(targetFlairLineVisible(input({ name: 'ashwarden' }))).toBe(true);
    expect(targetFlairLineVisible(input({ role: 'moderator' }))).toBe(true);
    expect(targetFlairLineVisible(input({ devIndex: 1 }))).toBe(true);
    expect(targetFlairLineVisible(input({ isAi: true }))).toBe(true);
  });

  it('is not moved by the language', () => {
    // Visibility is an identity question. Only the SIGNATURE keys the locale.
    expect(targetFlairLineVisible(input({ language: 'ja_JP' }))).toBe(false);
    expect(targetFlairLineVisible(input({ language: 'ja_JP', isAi: true }))).toBe(true);
  });
});

describe('targetFlairSignature: the language is part of the key', () => {
  it('MOVES when only the language moves, on identical identity data', () => {
    // THE FIX, asserted as the difference it has to make. Every field except the
    // language is byte-identical across the two calls, so a signature that
    // dropped the language (the shipped bug) makes these equal.
    const identity = { tier: 3, name: 'ashwarden', role: 'moderator', devIndex: 2, isAi: true };
    const before = targetFlairSignature(input({ ...identity, language: 'en' }));
    const after = targetFlairSignature(input({ ...identity, language: 'ja_JP' }));
    expect(after).not.toBe(before);
  });

  it('moves for a locale switch on an AI-only target, the reported case', () => {
    // The narrowest real shape: no Discord flair at all, only the AI mark, which
    // is exactly where nothing else could ever move the signature.
    expect(targetFlairSignature(input({ isAi: true, language: 'ru_RU' }))).not.toBe(
      targetFlairSignature(input({ isAi: true, language: 'en' })),
    );
  });

  it('still elides a steady frame: keying the locale is not un-gating the rebuild', () => {
    // The signature exists to stop a per-frame rebuild (a fresh <img> every frame
    // re-fetches the avatar). Proving the fix moves the key is only half; this is
    // the half that would catch "fix" it by making the signature always unique.
    const steady = input({ tier: 3, name: 'ashwarden', avatar: 'https://cdn/x.png' });
    expect(targetFlairSignature(steady)).toBe(targetFlairSignature({ ...steady }));
  });

  it('moves on each identity field on its own, so the locale key displaced nothing', () => {
    const base = input({ tier: 1, name: 'a', role: 'moderator', avatar: 'u', devIndex: 1 });
    const sig = targetFlairSignature(base);
    for (const over of [
      { tier: 2 },
      { name: 'b' },
      { role: 'developer' },
      { avatar: 'v' },
      { devIndex: 2 },
      { isAi: true },
    ] as Partial<TargetFlairLineInput>[]) {
      expect(targetFlairSignature({ ...base, ...over }), JSON.stringify(over)).not.toBe(sig);
    }
  });

  it('cannot be spoofed across fields by a value carrying the separator', () => {
    // A nickname really can contain '|', so the field boundaries have to survive
    // it: these two differ only in WHICH field the extra segment belongs to.
    expect(targetFlairSignature(input({ name: 'a|b', role: '' }))).not.toBe(
      targetFlairSignature(input({ name: 'a', role: 'b' })),
    );
  });
});

describe('targetFlairLineHtml', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  it('emits the AI mark with its localized label on both the aria-label and the title', () => {
    const html = targetFlairLineHtml(input({ isAi: true }));
    expect(html).toContain('class="ai-tag"');
    expect(html).toContain('role="img"');
    // The disclosure is spoken, not just hovered: aria-label AND title carry the
    // long form, the visible text the short mark.
    expect(html).toMatch(/aria-label="[^"]+"/);
    expect(html).toMatch(/title="[^"]+"/);
  });

  it('really re-renders in the new locale, so the signature is the only thing that was stale', async () => {
    // The other half of the bug report: the rebuild was always CORRECT, it just
    // never ran. If this were false the fix would have to be a fan-out arm rather
    // than a signature key. Driven over a REAL non-English locale (loaded first;
    // only en is resident synchronously) rather than the en_XA pseudo-locale,
    // which this runtime resolves to plain English.
    const en = targetFlairLineHtml(input({ isAi: true }));
    expect(en).toContain('AI-operated account');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    expect(getLanguage()).toBe('ja_JP');
    const ja = targetFlairLineHtml(input({ isAi: true }));
    setLanguage('en');
    expect(ja).not.toBe(en);
    // Named, not merely different: the screen-reader label is the face a player
    // hears, and it is the one that sat in the old locale.
    expect(ja).toContain('AI操作アカウント');
  });

  it('escapes an interpolated nickname and avatar url', () => {
    const html = targetFlairLineHtml(
      input({ name: '<script>x</script>', avatar: 'https://cdn/"onerror=alert(1)' }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;onerror');
  });

  it('omits the name span entirely when there is neither nickname nor avatar', () => {
    expect(targetFlairLineHtml(input({ isAi: true }))).not.toContain('uf-dc-name');
    expect(targetFlairLineHtml(input({ name: 'ashwarden' }))).toContain('uf-dc-name');
  });

  it('emits the avatar img only when an avatar url is present', () => {
    expect(targetFlairLineHtml(input({ name: 'ashwarden' }))).not.toContain('<img');
    expect(
      targetFlairLineHtml(input({ name: 'ashwarden', avatar: 'https://cdn/x.png' })),
    ).toContain('<img src="https://cdn/x.png"');
  });

  it('emits the rank chip only above rung 0', () => {
    expect(targetFlairLineHtml(input({ tier: 0, isAi: true }))).not.toContain('uf-dc-chip rank');
    expect(targetFlairLineHtml(input({ tier: 1 }))).toContain('uf-dc-chip rank');
  });

  it('emits nothing at all for an empty input', () => {
    expect(targetFlairLineHtml(input())).toBe('');
  });
});
