import { describe, expect, it } from 'vitest';
import { decideGuildMotdLine } from '../src/ui/guild_motd_login';
import type { SocialInfo } from '../src/world_api/social_graph';

// ClientWorld-shaped stub: a full SocialInfo as the social frame mirrors it,
// typed against the real IWorld facet so the helper's structural parameter is
// pinned to stay assignable from both worlds (the offline Sim side is the
// literal null cases below).
const online = (motd: string): SocialInfo => ({
  friends: [],
  blocks: [],
  ignores: [],
  guild: {
    id: 1,
    name: 'The Vale Wardens',
    rank: 'member',
    motd,
    motdSetBy: 'Aria',
    members: [],
    events: [],
  },
});

describe('guild motd login line decision', () => {
  it('shows on fresh login when a non-empty motd is first observed', () => {
    expect(decideGuildMotdLine(null, online('Raid night Friday'))).toEqual({
      emit: 'Raid night Friday',
      nextShown: 'Raid night Friday',
    });
  });

  it('suppresses an unchanged motd (snapshot re-pushes, linkdead resume)', () => {
    // The social frame is re-pushed on ANY social change; an unchanged motd
    // must never re-emit, no matter how many times it is re-observed.
    let shown: string | null = null;
    let emits = 0;
    for (let i = 0; i < 5; i++) {
      const d = decideGuildMotdLine(shown, online('Raid night Friday'));
      shown = d.nextShown;
      if (d.emit !== null) emits++;
    }
    expect(emits).toBe(1);
    expect(shown).toBe('Raid night Friday');
  });

  it('re-shows when the motd text changes mid-session', () => {
    const d = decideGuildMotdLine('Raid night Friday', online('Raid night Saturday'));
    expect(d.emit).toBe('Raid night Saturday');
    expect(d.nextShown).toBe('Raid night Saturday');
  });

  it('suppresses an empty or whitespace-only motd', () => {
    for (const motd of ['', '   ']) {
      expect(decideGuildMotdLine(null, online(motd))).toEqual({ emit: null, nextShown: null });
      expect(decideGuildMotdLine('Old text', online(motd))).toEqual({
        emit: null,
        nextShown: null,
      });
    }
  });

  it('suppresses when offline (Sim pins socialInfo to null) without crashing', () => {
    // The offline Sim's IWorld pins socialInfo to literal null; the echo is
    // online-only and the decision must be a silent no-op there.
    expect(decideGuildMotdLine(null, null)).toEqual({ emit: null, nextShown: null });
    expect(decideGuildMotdLine('Old text', undefined)).toEqual({ emit: null, nextShown: null });
  });

  it('suppresses when guildless or when the wire omits the motd field', () => {
    expect(decideGuildMotdLine(null, { guild: null })).toEqual({ emit: null, nextShown: null });
    // ClientWorld mirrors the wire, where motd can be absent at runtime despite
    // its declared type; the read must defend, like social_view does.
    expect(decideGuildMotdLine(null, { guild: {} })).toEqual({ emit: null, nextShown: null });
    expect(decideGuildMotdLine(null, { guild: { motd: null } })).toEqual({
      emit: null,
      nextShown: null,
    });
  });

  it('shows again when the motd is cleared and later set to the same text', () => {
    const first = decideGuildMotdLine(null, online('Hello guild'));
    expect(first.emit).toBe('Hello guild');
    const cleared = decideGuildMotdLine(first.nextShown, online(''));
    expect(cleared).toEqual({ emit: null, nextShown: null });
    const again = decideGuildMotdLine(cleared.nextShown, online('Hello guild'));
    expect(again.emit).toBe('Hello guild');
  });

  it('emits the motd text verbatim, untrimmed and unmodified', () => {
    const text = '  <b>Meet + greet</b> {text} [[i:123]]  ';
    const d = decideGuildMotdLine(null, online(text));
    expect(d.emit).toBe(text);
    expect(d.nextShown).toBe(text);
  });
});

describe('the HUD consumer contract (source pins)', () => {
  // The decision module is pure and fully covered above; the one seam with no
  // behavior test is its single consumer, so the HUD-side contracts are pinned
  // at the source level (the social_window precedent): the emitted text runs
  // through the display-side profanity mask like every other player-authored
  // chat-pane body, the line is tagged to the guild channel, its color
  // derives from the channel's single source of truth (never a hex literal),
  // and the append is PLAIN TEXT (the trailing `true`): the billboard's home
  // rendering is esc()'d plain text, so the echo must not linkify item
  // tokens from guild-controlled text (the behavioral half is in
  // tests/guild_motd_plaintext.test.ts).
  it('masks, channel-tags, channel-colors, and plain-appends the echo in hud.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const start = hud.indexOf('private updateGuildBillboardEcho()');
    expect(start).toBeGreaterThan(-1);
    const method = hud.slice(start, hud.indexOf('\n  }', start));
    expect(method).toContain('decideGuildMotdLine(this.lastShownGuildMotd, this.sim.socialInfo)');
    expect(method).toContain(
      "t('hudChrome.social.billboard.loginLine', { text: this.maskChat(motdLine.emit) })",
    );
    expect(method).toContain("chatChannelColor('guild')");
    expect(method).toContain("'guild',");
    // The plainText opt-out rides the call (the 7th argument): dropping it
    // re-opens the linkified-MOTD surface, so its presence is pinned here and
    // its EFFECT is pinned behaviorally in tests/guild_motd_plaintext.test.ts.
    expect(method).toMatch(/undefined,\s*\n\s*true,\s*\n\s*\);/);
    expect(method).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
