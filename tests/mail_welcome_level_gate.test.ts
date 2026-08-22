// The Ravenpost welcome letter is progression-gated (level 6): a character
// that never plays never mints a letter, so the shared mail book cannot
// re-accumulate dead welcome mail the way #3560's bot letters did. The gate
// has three entry paths (natural ding, dev/GM level jump, join with a
// restored save already past the gate) and every path books at most once.

import { describe, expect, it, vi } from 'vitest';
import { WELCOME_LETTER_LEVEL } from '../src/sim/mail/welcome_gate';
import type { Sim } from '../src/sim/sim';
import { xpForLevel } from '../src/sim/types';
import { makeWorld } from './vale_cup_util';

vi.setConfig({ testTimeout: 30000 });

interface MailBookLetter {
  letterId?: string;
  recipientName: string;
}

function welcomes(sim: Sim): MailBookLetter[] {
  return (sim.serializeMail() as { mail: MailBookLetter[] }).mail.filter(
    (m) => m.letterId === 'ravenpost_welcome',
  );
}

function xpToReach(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForLevel(l);
  return total;
}

describe('welcome letter level gate', () => {
  it('books nothing at character creation', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Fresh' });
    expect(welcomes(sim).length).toBe(0);
    expect(sim.players.get(sim.playerId)?.mailWelcomed).toBe(false);
  });

  it('books nothing below the gate, exactly one at it, and never a second', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Climber' });
    sim.grantXp(xpToReach(WELCOME_LETTER_LEVEL - 1));
    expect(sim.entities.get(sim.playerId)?.level).toBe(WELCOME_LETTER_LEVEL - 1);
    expect(welcomes(sim).length).toBe(0);

    sim.grantXp(xpForLevel(WELCOME_LETTER_LEVEL - 1));
    expect(sim.entities.get(sim.playerId)?.level).toBe(WELCOME_LETTER_LEVEL);
    const book = welcomes(sim);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Climber');

    sim.grantXp(xpForLevel(WELCOME_LETTER_LEVEL));
    expect(welcomes(sim).length).toBe(1);
  });

  it('a single multi-level grant across the gate books exactly once', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Rocket' });
    sim.grantXp(xpToReach(WELCOME_LETTER_LEVEL + 4));
    expect(sim.entities.get(sim.playerId)?.level).toBe(WELCOME_LETTER_LEVEL + 4);
    expect(welcomes(sim).length).toBe(1);
  });

  it('a dev/GM level jump past the gate books it, once', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Jumper' });
    sim.setPlayerLevel(20);
    expect(welcomes(sim).length).toBe(1);
    sim.setPlayerLevel(30);
    expect(welcomes(sim).length).toBe(1);
  });

  it('a restored save already past the gate books on join (pre-mail service announcement)', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Oldtimer' });
    sim.setPlayerLevel(30);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('serializeCharacter returned nothing');
    // Simulate a save from before mail existed: past the gate, never welcomed.
    const preMail = { ...state, mailWelcomed: false };

    const restored = makeWorld({});
    const pid = restored.addPlayer('warrior', 'Oldtimer', { state: preMail });
    const book = welcomes(restored);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Oldtimer');
    expect(restored.players.get(pid)?.mailWelcomed).toBe(true);
  });

  it('a restored sub-gate save books nothing on join and books on its later ding', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Sprout' });
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('serializeCharacter returned nothing');

    const restored = makeWorld({});
    const pid = restored.addPlayer('warrior', 'Sprout', { state });
    expect(welcomes(restored).length).toBe(0);
    restored.setPlayerLevel(WELCOME_LETTER_LEVEL, pid);
    expect(welcomes(restored).length).toBe(1);
  });

  it('a bot leveled past the gate never books (the bot pre-flip holds)', () => {
    const sim = makeWorld({});
    const pid = sim.addPlayer('mage', 'Botty', { bot: true });
    sim.setPlayerLevel(20, pid);
    expect(welcomes(sim).length).toBe(0);
  });
});
