// Character Armory: the server privacy filter (no sensitive fields leak) and the
// pure profile render. Icons are procedural canvas (no DOM in node), so the icon
// module is mocked here; the DB pool is spied so no real connection opens.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
});
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (_kind: string, id: string) => `icon:${id}`,
  QUALITY_COLOR: { poor: '#9d9d9d', common: '#fff', uncommon: '#1eff00', rare: '#0070dd', epic: '#a335ee' },
}));

import { pool, getArmoryCharacter } from '../server/db';
import { armoryProfileHtml } from '../src/ui/armory';
import { ITEMS } from '../src/sim/data';
import type { ArmoryProfile } from '../src/world_api';

describe('armory: server privacy filter', () => {
  it('returns only safe public fields, never money / inventory / position / quests', async () => {
    const fullState = {
      level: 18, xp: 4200, lifetimeXp: 999, prestigeRank: 2,
      copper: 123456, hp: 50, resource: 10,
      pos: { x: 42, z: -7 }, facing: 1.2,
      equipment: { mainhand: 'iron_sword', chest: 'leather_vest' },
      inventory: [{ itemId: 'secret_item', count: 9 }],
      questLog: [{ questId: 'q1', counts: [1], state: 'active' }],
      questsDone: ['q_secret_quest'],
      arenaRating: 1640, arenaWins: 7, arenaLosses: 3,
      talents: { spec: 'arms', ranks: { n1: 3 }, choices: {} },
    };
    const spy = vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ name: 'Thrall', class: 'warrior', level: 18, realm: 'Eastbrook', state: fullState }],
    } as any);
    const row = await getArmoryCharacter('thrall');
    spy.mockRestore();

    expect(row).toBeTruthy();
    // safe fields preserved
    expect(row!.name).toBe('Thrall');
    expect(row!.lifetimeXp).toBe(999);
    expect(row!.prestigeRank).toBe(2);
    expect(row!.arenaRating).toBe(1640);
    expect(row!.equipment.mainhand).toBe('iron_sword');
    expect(row!.talents?.spec).toBe('arms');
    // sensitive data must NOT be present anywhere in the returned object
    const json = JSON.stringify(row);
    expect(json).not.toContain('123456');        // copper
    expect(json).not.toContain('secret_item');   // inventory
    expect(json).not.toContain('q_secret_quest'); // quest history
    expect(json).not.toMatch(/"copper"|"inventory"|"pos"|"facing"|"questLog"|"questsDone"|"hp"|"resource"/);
  });

  it('returns null for an unknown character', async () => {
    const spy = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as any);
    expect(await getArmoryCharacter('nobody')).toBeNull();
    spy.mockRestore();
  });
});

describe('armory: profile render', () => {
  const mainhandId = Object.keys(ITEMS).find((id) => ITEMS[id].slot === 'mainhand')!;
  const base: ArmoryProfile = {
    name: 'Thrall', cls: 'warrior', level: 20, virtualLevel: 23, lifetimeXp: 1234567,
    prestigeRank: 1, realm: 'Eastbrook', arenaRating: 1640, arenaWins: 7, arenaLosses: 3,
    equipment: { mainhand: mainhandId }, talents: null,
  };

  it('renders identity, level/overflow, arena, gear and section titles', () => {
    const html = armoryProfileHtml(base);
    expect(html).toContain('Thrall');
    expect(html).toContain('Warrior');
    expect(html).toContain('Level 20');
    expect(html).toContain('(+3)'); // virtual-level overflow at the cap
    expect(html).toContain('1,234,567'); // lifetime XP formatted
    expect(html).toContain('1640 (7-3)'); // arena record
    expect(html).toContain('Equipment');
    expect(html).toContain('Talents');
    expect(html).toContain('Main Hand');
    expect(html).toContain(ITEMS[mainhandId].name); // the equipped item's name
  });

  it('shows Empty for unequipped slots', () => {
    const html = armoryProfileHtml({ ...base, equipment: {} });
    expect(html).toContain('Empty');
  });

  it('escapes HTML in the character name', () => {
    const html = armoryProfileHtml({ ...base, name: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
