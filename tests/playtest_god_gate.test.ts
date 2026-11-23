// The editor playtest god-mode hook (Sim.setDevGod, src/sim/authored_world_hooks.ts)
// is an offline authored-world affordance only. The server and the default world
// build their Sim without `cfg.world`, so the hook must refuse there, and it must
// never ride the wire command surface (where it would sidestep ALLOW_DEV_COMMANDS).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { COMMAND_NAMES } from '../src/world_api';

describe('playtest god-mode gate', () => {
  it('refuses on a Sim built without a custom world (server and default-world shape)', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', playerName: 'Live' });
    expect(sim.setDevGod(true, sim.playerId)).toBe(false);
    expect(sim.player.devGod).toBeFalsy();
  });

  it('refuses even with dev commands on when no custom world was passed', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', devCommands: true });
    expect(sim.setDevGod(true, sim.playerId)).toBe(false);
    expect(sim.player.devGod).toBeFalsy();
  });

  it('toggles on and off in an authored world, and refuses a non-player id', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', world: BUILTIN_WORLD });
    sim.player.hp = 1;
    expect(sim.setDevGod(true, sim.playerId)).toBe(true);
    expect(sim.player.devGod).toBe(true);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(sim.setDevGod(false, sim.playerId)).toBe(true);
    expect(sim.player.devGod).toBe(false);
    const npc = [...sim.entities.values()].find((e) => e.kind !== 'player');
    if (npc) expect(sim.setDevGod(true, npc.id)).toBe(false);
  });

  it('is not a wire command and no server or headless file reaches it', () => {
    expect(COMMAND_NAMES as readonly string[]).not.toContain('setDevGod');
    for (const dir of ['server', 'headless']) {
      const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
        f.endsWith('.ts'),
      );
      for (const file of files) {
        expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(
          /setDevGod|setPlaytestGod|authored_world_hooks/,
        );
      }
    }
    // The realm boot config never hands the Sim a custom world.
    expect(readFileSync('server/sim_boot_config.ts', 'utf8')).not.toMatch(/\bworld\s*:/);
  });
});
