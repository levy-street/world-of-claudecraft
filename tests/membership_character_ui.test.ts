import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CharacterRequests } from '../src/net/character_requests';
import { applyCharacterRoster } from '../src/net/character_roster';
import { charselectPrimaryAction } from '../src/net/charselect_action';
import {
  canCreateMembershipCharacter,
  characterRowHtml,
  membershipSlotsHtml,
} from '../src/ui/character_membership_view';

describe('membership character selection', () => {
  it('renders the empty-account roster after opening creation and uses the server capacity', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const emptyBranch = main.match(/if \(chars.length === 0\) \{([\s\S]*?)\n {4}\}/)?.[1];
    expect(emptyBranch).toContain("show('#charcreate-panel')");
    expect(emptyBranch).not.toMatch(/\breturn\b/);
    expect(main).toContain(
      'membershipSlotsHtml(chars, api.characterMembership.active, api.characterLimit)',
    );
    expect(main).toContain("listEl.querySelector('.char-row:not(.char-empty-slot)')");
    // Placeholder rows are plain list items, so selection resets never stamp aria-selected on them.
    expect(main).not.toContain("querySelectorAll('#char-list .char-row')");
    // The empty-account path keeps the creation preview instead of the warrior showcase.
    expect(main).toMatch(/\} else if \(chars\.length > 0\) \{\s*previewClassBody\('warrior'\)/);
  });
  it.each([
    // active, current capacity, occupied base/premium, empty base/premium, locked
    [false, 10, 0, 0, 10, 10, 10],
    [true, 20, 0, 0, 10, 10, 0],
    [false, 10, 9, 10, 1, 0, 0],
    [true, 20, 9, 10, 1, 0, 0],
    [false, 15, 12, 2, 3, 8, 8],
    [true, 25, 12, 2, 3, 8, 0],
    [false, 10, 10, 10, 0, 0, 0],
    [true, 25, 15, 10, 0, 0, 0],
    [false, 10, 12, 11, 0, 0, 0],
  ] as const)(
    'renders all empty slots (active=%s, capacity=%s, base=%s, premium=%s)',
    (active, limit, base, premium, emptyBase, emptyPremium, locked) => {
      const roster = [
        ...Array.from({ length: premium }, () => ({ membershipSlot: true })),
        ...Array.from({ length: base }, () => ({})),
      ];
      const html = membershipSlotsHtml(roster, active, limit);
      expect(html.match(/<li /g) ?? []).toHaveLength(emptyBase + emptyPremium);
      expect(html.match(/membership-slot/g) ?? []).toHaveLength(emptyPremium);
      expect(html.match(/membership-locked/g) ?? []).toHaveLength(locked);
      expect(html.match(/char-slot-lock/g) ?? []).toHaveLength(locked);
      expect(html.match(/Available character slot/g) ?? []).toHaveLength(
        emptyBase + emptyPremium - locked,
      );
      expect(html.match(/Unlock slots with a membership/g) ?? []).toHaveLength(locked);
      expect(html).not.toContain('role="option"');
      expect(html).not.toContain('tabindex');
    },
  );

  it('keeps a freed base slot usable while premium characters are locked', () => {
    const roster = [
      ...Array.from({ length: 9 }, () => ({ membershipSlot: false })),
      ...Array.from({ length: 10 }, () => ({ membershipSlot: true })),
    ];
    expect(canCreateMembershipCharacter(roster, false, 10)).toBe(true);
    expect(canCreateMembershipCharacter([...roster, { membershipSlot: false }], false, 10)).toBe(
      false,
    );
    expect(canCreateMembershipCharacter(roster, true, 20)).toBe(true);
  });

  it('blocks every locked primary action, including takeover', () => {
    for (const online of [false, true]) {
      const row = {
        name: '<img>',
        class: 'warrior' as const,
        level: 1,
        online,
        forceRename: false,
        membershipLocked: true,
      };
      expect(charselectPrimaryAction(row).kind).toBe('disabled');
      const html = characterRowHtml(row, '', 0);
      expect(html).toContain('disabled');
      expect(html).toContain('char-slot-lock');
      expect(html).not.toContain('take-over-btn');
      expect(html).toContain('&lt;img&gt;');
    }
  });

  it('preserves roster membership data and clears stale access for an older server', () => {
    const target = {
      realm: null as string | null,
      characterMembership: { active: false, expiresAt: null as string | null },
      characterLimit: 10,
    };
    applyCharacterRoster(target, {
      characters: [],
      realm: 'East',
      membership: { active: true, expiresAt: '2026-11-01' },
      characterLimit: 20,
    });
    expect(target.characterMembership.active).toBe(true);
    expect(target.characterLimit).toBe(20);
    applyCharacterRoster(target, { characters: [] });
    expect(target.characterMembership).toEqual({ active: false, expiresAt: null });
    expect(target.characterLimit).toBe(10);
  });

  it('preserves character mutation payloads after extracting the request adapter', async () => {
    const calls: unknown[] = [];
    const requests = new CharacterRequests(
      async (path, body) => {
        calls.push([path, body]);
        return { takenOver: true };
      },
      async () => ({}),
    );
    await requests.create('Alice', 'warrior');
    expect(calls[0]).toEqual([
      '/api/characters',
      { name: 'Alice', class: 'warrior', skin: 0, helmHidden: true },
    ]);
    expect(await requests.takeoverCharacter(42)).toBe(true);
  });
});
