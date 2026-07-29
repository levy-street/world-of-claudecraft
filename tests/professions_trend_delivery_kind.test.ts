// Guild letter delivery contract (kind, multi-player, determinism). Split from
// tests/professions_trend.test.ts along describe boundaries for CI shard
// balance (a pure move; shared helpers in professions_trend_util.ts).

import { describe, expect, it } from 'vitest';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import type { SimEvent } from '../src/sim/types';
import {
  GUILD_DELIVERY_TEST_TIMEOUT_MS,
  guildLetters,
  letterDelay,
  makeWorld,
  tickFor,
} from './professions_trend_util';

describe('the Guild letter delivery contract', () => {
  it(
    'the booked mail is the system kind from The Crafting Guild on the mailbox surface',
    () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Tinker');
      sim.gainCraftSkill(pid, 'engineering', 15);
      sim.gainCraftSkill(pid, 'alchemy', 15);
      tickFor(sim, letterDelay('engineering+alchemy') + 5);
      // Read the REAL mailbox window surface (proximity-gated): park the
      // character at the Eastbrook raven pillar and stream mailInfo.
      const e = sim.entities.get(pid);
      if (!e) throw new Error('no entity');
      e.pos.x = EASTBROOK_LAYOUT.services.mailbox.position.x;
      e.pos.z = EASTBROOK_LAYOUT.services.mailbox.position.z;
      sim.tick();
      const info = sim.mailInfoFor(pid);
      if (!info) throw new Error('expected mailInfo at the mailbox');
      const guild = info.messages.find((m) => (m.letterId ?? '').startsWith('guild_trend_'));
      expect(guild).toMatchObject({
        kind: 'system',
        letterId: 'guild_trend_engineering_alchemy',
        senderName: 'The Crafting Guild',
        subject: 'Your work in Engineering and Alchemy',
        read: false,
      });
    },
    GUILD_DELIVERY_TEST_TIMEOUT_MS,
  );

  it(
    'two players crossing in the same sweep each get exactly their own pair letter',
    () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Anvil');
      const b = sim.addPlayer('mage', 'Loom');
      sim.gainCraftSkill(a, 'weaponcrafting', 15);
      sim.gainCraftSkill(a, 'armorcrafting', 15);
      sim.gainCraftSkill(b, 'tailoring', 15);
      sim.gainCraftSkill(b, 'inscription', 15);
      const events = tickFor(sim, letterDelay('weaponcrafting+armorcrafting') + 5);
      const la = guildLetters(events, a);
      const lb = guildLetters(events, b);
      expect(la).toHaveLength(1);
      expect(la[0]).toMatchObject({ letterId: 'guild_trend_weaponcrafting_armorcrafting' });
      expect(lb).toHaveLength(1);
      expect(lb[0]).toMatchObject({ letterId: 'guild_trend_tailoring_inscription' });
    },
    GUILD_DELIVERY_TEST_TIMEOUT_MS,
  );

  it(
    'same seed, same inputs: the letter arrives on the same tick with an identical event',
    () => {
      const run = () => {
        const sim = makeWorld();
        const pid = sim.addPlayer('warrior', 'Tinker');
        sim.gainCraftSkill(pid, 'engineering', 15);
        sim.gainCraftSkill(pid, 'alchemy', 15);
        const arrivals: { tick: number; ev: SimEvent }[] = [];
        const total = Math.ceil((letterDelay('engineering+alchemy') + 5) * 20);
        for (let t = 0; t < total; t++) {
          for (const ev of sim.tick()) {
            if (ev.type === 'mailArrived' && (ev.letterId ?? '').startsWith('guild_trend_')) {
              arrivals.push({ tick: t, ev });
            }
          }
        }
        return arrivals;
      };
      const first = run();
      expect(first).toHaveLength(1);
      expect(run()).toEqual(first);
    },
    2 * GUILD_DELIVERY_TEST_TIMEOUT_MS,
  );
});
