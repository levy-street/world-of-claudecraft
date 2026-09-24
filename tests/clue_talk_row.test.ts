// A Clue Scroll talk step solved from the NPC's gossip window (playtest: clicking
// Ferrymaster Caddow opened his window and the hunt never moved, because the
// window opens client-side and never reaches Sim.talkToNpc), and answered in the
// NPC's own voice (playtest: the window just jumped to the next clue).
import { describe, expect, it } from 'vitest';
import { CLUE_HUNTS } from '../src/sim/content/clue_hunts';
import { Sim } from '../src/sim/sim';
import { clueReplyKey, clueTalkFor } from '../src/ui/hud/quest/clue_talk_row_core';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { ja_JP } from '../src/ui/i18n.resolved.generated/ja_JP';
import { ko_KR } from '../src/ui/i18n.resolved.generated/ko_KR';
import { ru_RU } from '../src/ui/i18n.resolved.generated/ru_RU';
import { zh_CN } from '../src/ui/i18n.resolved.generated/zh_CN';
import { zh_TW } from '../src/ui/i18n.resolved.generated/zh_TW';

const HUNT = 'hunt_amberfall_lantern_ferry';
const water = (count: number) => [{ itemId: 'spring_water', count }];

describe('the clue talk row', () => {
  it('offers the row only at the NPC the current talk or delivery step names', () => {
    // Step 0: speak with Ferrymaster Caddow.
    expect(clueTalkFor({ huntId: HUNT, step: 0 }, 'ferrymaster_caddow', [])).toEqual({
      huntId: HUNT,
      step: 0,
      ready: true,
    });
    expect(clueTalkFor({ huntId: HUNT, step: 0 }, 'orchardist_pomeline', [])).toBeNull();
    // Step 1 is a landmark: no NPC answers it.
    expect(clueTalkFor({ huntId: HUNT, step: 1 }, 'ferrymaster_caddow', [])).toBeNull();
    expect(clueTalkFor(null, 'ferrymaster_caddow', [])).toBeNull();
    expect(clueTalkFor({ huntId: 'retired_hunt', step: 0 }, 'ferrymaster_caddow', [])).toBeNull();
  });

  it('a delivery is ready only when the asked count is carried, across stacks', () => {
    const at = (inv: { itemId: string; count: number }[]) =>
      clueTalkFor({ huntId: HUNT, step: 2 }, 'orchardist_pomeline', inv)?.ready;
    expect(at([])).toBe(false);
    expect(at(water(2))).toBe(false);
    expect(at([...water(1), ...water(2)])).toBe(true);
  });

  it('every talk and delivery step of every hunt has an answer, in all five non-Latin locales', () => {
    const tables: Record<string, unknown> = { en, ja_JP, ko_KR, ru_RU, zh_CN, zh_TW };
    // The resolved tables are nested by the dotted key's segments.
    const lookup = (table: unknown, key: string): unknown =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          table,
        );
    let steps = 0;
    for (const hunt of CLUE_HUNTS) {
      hunt.steps.forEach((step, index) => {
        if (step.kind !== 'npc' && step.kind !== 'deliver') return;
        steps++;
        const key = clueReplyKey(hunt.id, index);
        for (const [locale, table] of Object.entries(tables)) {
          const text = lookup(table, key);
          expect(typeof text === 'string' && text.length > 0, `${locale} ${key}`).toBe(true);
          if (locale !== 'en') expect(text, `${locale} ${key}`).not.toBe(lookup(en, key));
        }
      });
    }
    expect(steps).toBeGreaterThan(0);
  });

  it("the row's action (target, then interact) advances the hunt", () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', autoEquip: true, devCommands: true });
    const pid = sim.player.id;
    sim.chat('/dev level 20', pid);
    sim.chat(`/dev clue hunt ${HUNT}`, pid);
    const caddow = [...sim.entities.values()].find((e) => e.templateId === 'ferrymaster_caddow');
    if (!caddow) throw new Error('missing Caddow');
    sim.chat(`/dev tp ${caddow.pos.x + 1} ${caddow.pos.z + 1}`, pid);
    const meta = sim.meta(pid);
    expect(meta?.clueHunt).toEqual({ huntId: HUNT, step: 0 });
    sim.targetEntity(caddow.id);
    sim.interact();
    expect(meta?.clueHunt).toEqual({ huntId: HUNT, step: 1 });
  });
});
