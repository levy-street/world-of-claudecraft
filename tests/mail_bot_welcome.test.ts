// Bots must never receive mail (issue #3560): every synthetic participant the
// sim creates (fiesta practice bots, /dev bots; the retired Vale Cup showcase
// was the original offender) is
// created with the Ravenpost welcome suppressed, while a real new character
// still receives exactly one welcome letter. Before this gate existed, every
// hourly-ish showcase minted six immortal welcome letters into the shared mail
// book (134k letters, 85MB of the prod world_state row by 2026-08-22), and the
// 30s autosave serialized all of it on the main thread.

import { describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/sim/sim';
import { startFiestaPractice } from '../src/sim/social/fiesta_bots';
import type { SimConfig } from '../src/sim/types';

// The retired vale_cup_util factory, minus its prebuilt cup world: a plain
// no-player Sim is all these cases need.
function makeWorld(overrides: Partial<SimConfig> = {}): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, ...overrides });
}

vi.setConfig({ testTimeout: 30000 });

interface MailBookLetter {
  letterId?: string;
  recipientName: string;
}

function letters(sim: Sim): MailBookLetter[] {
  return (sim.serializeMail() as { mail: MailBookLetter[] }).mail;
}

describe('bot players receive no welcome mail', () => {
  it('a real new character receives exactly one welcome letter', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].letterId).toBe('ravenpost_welcome');
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
    const pid = sim.spawnDevBot('Helper');
    expect(pid).toBeGreaterThan(0);
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Watcher');
  });

  it('a fiesta practice set creates no letters for its three bots', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    expect(startFiestaPractice(sim)).toBe(true);
    expect(sim.fiestaBotPids.length).toBe(3);
    const book = letters(sim);
    expect(book.length).toBe(1);
    expect(book[0].recipientName).toBe('Watcher');
  });
});
