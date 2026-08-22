// Bots must never receive mail (issue #3560): every synthetic participant the
// sim creates (Vale Cup showcase bots, fiesta practice bots, /dev bots) is
// created with the Ravenpost welcome suppressed. The human welcome is
// level-gated at 6 (tests/mail_welcome_level_gate.test.ts owns that story);
// here the human is leveled past the gate so every pin keeps the decisive
// human-gets-mail vs bot-gets-nothing contrast. Before this gate existed, every
// hourly-ish showcase minted six immortal welcome letters into the shared mail
// book (134k letters, 85MB of the prod world_state row by 2026-08-22), and the
// 30s autosave serialized all of it on the main thread.

import { describe, expect, it, vi } from 'vitest';
import type { Sim } from '../src/sim/sim';
import { startFiestaPractice } from '../src/sim/social/fiesta_bots';
import { makeWorld } from './vale_cup_util';

vi.setConfig({ testTimeout: 30000 });

interface MailBookLetter {
  letterId?: string;
  recipientName: string;
}

function letters(sim: Sim): MailBookLetter[] {
  return (sim.serializeMail() as { mail: MailBookLetter[] }).mail;
}

describe('bot players receive no welcome mail', () => {
  it('a new character books nothing at creation; the gate books it at level 6', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    expect(letters(sim).length).toBe(0);
    sim.setPlayerLevel(6);
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].letterId).toBe('ravenpost_welcome');
    expect(book[0].recipientName).toBe('Watcher');
  });

  it('a 3v3 bot showcase creates zero new letters', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    sim.setPlayerLevel(6);
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    // The showcase really staged: six bots are seated.
    expect(sim.vcup.botPids.length).toBe(6);
    // The book still holds only the human's welcome, nothing addressed to bots.
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Watcher');
  });

  it('addPlayer with bot: true sends no welcome and marks the meta pre-welcomed', () => {
    const sim = makeWorld({});
    const pid = sim.addPlayer('mage', 'Botty', { bot: true });
    expect(letters(sim).length).toBe(0);
    // Pre-welcomed, so no later path can ever mint the letter for this meta.
    expect(sim.players.get(pid)?.mailWelcomed).toBe(true);
  });

  // The per-site pins below exist so a refactor of a spawner cannot silently
  // drop its bot flag: each site is exercised through its own entry point.

  it('a /dev bot spawn creates no letters', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    sim.setPlayerLevel(6);
    const pid = sim.spawnDevBot('Helper');
    expect(pid).toBeGreaterThan(0);
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Watcher');
  });

  it('a fiesta practice set creates no letters for its three bots', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    sim.setPlayerLevel(6);
    expect(startFiestaPractice(sim)).toBe(true);
    expect(sim.fiestaBotPids.length).toBe(3);
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Watcher');
  });
});
