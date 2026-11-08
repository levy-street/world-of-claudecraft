import { describe, expect, it } from 'vitest';
import { addReferralGuide } from '../scripts/mediawiki/referral_guide';
import { systemWriter } from '../scripts/mediawiki/system_writer';
import { DUNGEONS, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { REFERRAL_MILESTONES } from '../src/sim/referral_cards';

function titleMap(entries: Record<string, { name: string }>, kind: string) {
  return new Map(Object.entries(entries).map(([id, entry]) => [id, `${entry.name} (${kind})`]));
}

describe('Referral cards wiki guide', () => {
  const pages = new Map<string, string>();
  const w = systemWriter({
    add: (title, body) => pages.set(title, body),
    unique: (title) => title,
    titleBy: {
      item: titleMap(ITEMS, 'Item'),
      quest: titleMap(QUESTS, 'Quest'),
      dungeon: titleMap(DUNGEONS, 'Dungeon'),
      mob: titleMap(MOBS, 'Enemy'),
      npc: titleMap(NPCS, 'NPC'),
      zone: new Map(),
    },
  });
  addReferralGuide(w);
  w.finish();
  const body = pages.get('Referral cards')!;

  it('gives both players the actual signup, party and confirmation steps in order', () => {
    const start = body.split('== How to start a card ==')[1].split('==')[0];
    const instructions = start.split('\n').filter((line) => line.startsWith('# '));
    expect(instructions).toHaveLength(5);
    expect(instructions[0]).toMatch(/Social.*Refer a Friend.*Your invitation link/);
    expect(instructions[1]).toMatch(/Create Account.*existing account cannot be linked/i);
    expect(instructions[2]).toMatch(/level 1 to 4.*\[\[Set Sail \(Quest\)\|Set Sail\]\]/);
    expect(instructions[3]).toMatch(/\/invite.*accepts the party invitation/);
    expect(instructions[4]).toMatch(/each player chooses “Accept”.*either player.*Start a card/);
  });

  it('links the milestone quests, dungeon bosses and rewards and explains each player’s claims', () => {
    for (const { questId, dungeonId } of REFERRAL_MILESTONES) {
      if (questId) expect(body).toContain(`[[${QUESTS[questId].name} (Quest)|`);
      if (dungeonId) expect(body).toContain(`[[${DUNGEONS[dungeonId].name} (Dungeon)|`);
    }
    for (const [id, level] of [
      ['morthen', 5],
      ['vael_the_mistcaller', 12],
      ['korzul_the_gravewyrm', 18],
    ] as const) {
      const row = body.split('\n').find((line) => line.includes(`[[${MOBS[id].name} (Enemy)|`));
      expect(row).toContain(`level ${level} or higher`);
    }
    expect(body).toContain('finish it on both assigned characters and form a party together again');
    expect(body).toContain('Yes, lock this card');
    expect(body).toContain('invited friends who have personally redeemed all five stamps');
    expect(body).toContain('[[Jelly Saddle: Wobbles (Item)|');
  });
});
