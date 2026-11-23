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
  it('renders ten locked slots for nonmembers and accounts for occupied premium slots', () => {
    expect(membershipSlotsHtml([], false).match(/membership-slot/g)).toHaveLength(10);
    expect(
      membershipSlotsHtml([{ membershipSlot: true }], false).match(/membership-slot/g),
    ).toHaveLength(9);
    expect(membershipSlotsHtml([{}, {}], true).match(/membership-slot/g)).toHaveLength(18);
  });

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
