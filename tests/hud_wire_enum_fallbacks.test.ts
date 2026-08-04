// The wire-union ?? fallbacks in hud.ts (R34's enum axis): every result code
// on the mail/calendar/billboard/honor events is a SERVER value a newer
// deploy can widen, and t() throws on an undefined key, so each family
// degrades to its most generic line through a `?? *_FALLBACK_KEY` arm. Two
// halves pinned here without importing the DOM-heavy hud module: the four
// fallback arms exist at their dispatch sites (comment-stripped source), and
// each fallback key literal actually resolves in the shipped English table
// (a key typo would turn the safety arm into the very throw it guards).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../src/ui/i18n.resolved.generated';

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const HUD = stripComments(readFileSync(resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8'));

const FAMILIES: { arm: string; decl: RegExp }[] = [
  {
    arm: 'MAIL_RESULT_ERROR_KEYS[ev.code] ?? MAIL_RESULT_FALLBACK_KEY',
    decl: /MAIL_RESULT_FALLBACK_KEY: TranslationKey = '([^']+)'/,
  },
  {
    arm: 'CALENDAR_RESULT_KEYS[ev.code] ?? CALENDAR_RESULT_FALLBACK_KEY',
    decl: /CALENDAR_RESULT_FALLBACK_KEY: TranslationKey = '([^']+)'/,
  },
  {
    arm: 'MOTD_RESULT_KEYS[ev.code] ?? MOTD_RESULT_FALLBACK_KEY',
    decl: /MOTD_RESULT_FALLBACK_KEY: TranslationKey = '([^']+)'/,
  },
  {
    arm: 'HONOR_REASON_KEYS[ev.reason] ?? HONOR_REASON_FALLBACK_KEY',
    decl: /HONOR_REASON_FALLBACK_KEY: TranslationKey = '([^']+)'/,
  },
];

function resolveDotted(key: string): unknown {
  let node: unknown = en;
  for (const segment of key.split('.')) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, segment)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

describe('the peer-typed chat-link guards (the remote-reachable arm)', () => {
  // A [[i:constructor]] token in a peer's chat line is the one prototype-key
  // path any player can fire at any other; the predicate itself is unit
  // tested in known_item.test.ts, so what is pinned here is that BOTH hud
  // sinks (the interactive span and the 3D-bubble plain text) resolve
  // through it rather than a bare table read.
  it('the interactive link and the plain-text form both read through the predicate', () => {
    const linkBody = HUD.slice(HUD.indexOf('private appendChatItemLink('));
    expect(linkBody.slice(0, 400)).toContain('knownItemDef(ITEMS, itemId)');
    const plainBody = HUD.slice(HUD.indexOf('private chatLinkPlainText('));
    expect(plainBody.slice(0, 500)).toContain('knownItemDef(ITEMS, s.itemId)');
    expect(plainBody.slice(0, 500)).toContain('ownEntry(QUESTS, s.questId)');
  });
});

describe('the trade panel first-paint visibility (R34 review)', () => {
  it('the display write sits inside the repaint guard, BEFORE the render try', () => {
    // A throw on the FIRST paint used to leave a live trade with no panel at
    // all (no Accept, no Cancel): the visible-before-render ordering is the
    // fix, and only source order can pin it (the render is throw-free by
    // construction today).
    const guardAt = HUD.indexOf('if (sig === this.lastTradeSig) return;');
    expect(guardAt).toBeGreaterThan(-1);
    const window = HUD.slice(guardAt, guardAt + 600);
    const displayAt = window.indexOf("el.style.display = 'block';");
    const tryAt = window.indexOf('try {');
    expect(displayAt).toBeGreaterThan(-1);
    expect(tryAt).toBeGreaterThan(-1);
    expect(displayAt).toBeLessThan(tryAt);
  });
});

describe('the hud wire-enum fallback family', () => {
  it('all four dispatch sites carry their ?? fallback arm', () => {
    for (const family of FAMILIES) {
      expect(HUD.includes(family.arm), family.arm).toBe(true);
    }
  });

  it('every fallback key literal resolves to a real English string', () => {
    for (const family of FAMILIES) {
      const match = HUD.match(family.decl);
      expect(match, String(family.decl)).toBeTruthy();
      const key = match?.[1] ?? '';
      const value = resolveDotted(key);
      expect(typeof value, key).toBe('string');
      expect((value as string).length, key).toBeGreaterThan(0);
    }
  });
});
