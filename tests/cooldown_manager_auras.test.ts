import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { CLASSES } from '../src/sim/content/classes';
import type { PlayerClass } from '../src/sim/types';
import { talentAuraKind } from '../src/ui/aura_overlay_view';
import {
  cooldownAuraCatalog,
  ENGINE_AURAS,
  findCooldownAura,
  isCooldownAuraToken,
  parseCooldownAuraToken,
  seenAuraEntry,
} from '../src/ui/hud/cooldown_manager/cooldown_manager_auras';
import { sanitizeCooldownGroups } from '../src/ui/hud/cooldown_manager/cooldown_manager_config';
import { tsFilesUnder } from './helpers/ts_files_under';

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];
const SIM_SOURCES = tsFilesUnder(fileURLToPath(new URL('../src/sim', import.meta.url)))
  .filter(({ file }) => !file.endsWith('types.ts'))
  .map(({ full }) => readFileSync(full, 'utf8'));

describe('cooldown manager aura catalog', () => {
  it('pins every engine row against the sim: its kind and the English name it is minted with', () => {
    expect(SIM_SOURCES.length).toBeGreaterThan(100);
    let rows = 0;
    for (const cls of CLASS_IDS) {
      for (const row of ENGINE_AURAS[cls]) {
        rows++;
        // Both literals in ONE sim module: a rename of either fails here instead
        // of leaving a tracked engine that never lights.
        const minted = SIM_SOURCES.some(
          (source) => source.includes(`'${row.kind}'`) && source.includes(`'${row.name}'`),
        );
        expect(minted, `${cls}: ${row.kind} "${row.name}"`).toBe(true);
      }
    }
    expect(rows).toBeGreaterThanOrEqual(15);
  });

  it('gives every class a catalog of unique, parseable aura tokens', () => {
    for (const cls of CLASS_IDS) {
      const catalog = cooldownAuraCatalog(cls);
      expect(catalog.length, cls).toBeGreaterThan(0);
      const tokens = catalog.map((entry) => entry.token);
      expect(new Set(tokens).size, cls).toBe(tokens.length);
      for (const entry of catalog) {
        expect(isCooldownAuraToken(entry.token)).toBe(true);
        expect(parseCooldownAuraToken(entry.token)).toEqual({
          match: entry.match,
          value: entry.value,
        });
        // A stored group keeps the token through a save and a load.
        const [group] = sanitizeCooldownGroups([{ id: 'g1', kind: 'line', spells: [entry.token] }]);
        expect(group.spells, entry.token).toEqual([entry.token]);
      }
    }
  });

  it('lists the class engines first and every talent proc of every row option', () => {
    expect(
      cooldownAuraCatalog('druid')
        .slice(0, 3)
        .map((e) => e.token),
    ).toEqual(['kind:old_blood', 'kind:moontide', 'kind:verdance']);
    expect(cooldownAuraCatalog('warlock').map((e) => e.token)).toEqual(
      expect.arrayContaining(['kind:soul_fragments', 'kind:destruction_ruin']),
    );
    expect(cooldownAuraCatalog('mage').map((e) => e.token)).toContain('kind:icicles');
    for (const cls of CLASS_IDS) {
      const tokens = new Set(cooldownAuraCatalog(cls).map((entry) => entry.token));
      for (const row of CHOICE_ROWS[cls].rows) {
        for (const choice of row.options) {
          const proc = choice.effect.proc;
          if (!proc || !proc.responses.some((r) => talentAuraKind(r) !== null)) continue;
          expect(tokens.has(`aura:${proc.id}`), `${cls}: ${proc.id}`).toBe(true);
        }
      }
    }
  });

  it('includes the Auras panel procs of every spec (Hot Streak, Sudden Death)', () => {
    expect(cooldownAuraCatalog('mage').map((e) => e.token)).toContain('aura:hot_streak');
    expect(cooldownAuraCatalog('warrior').map((e) => e.token)).toContain('aura:sudden_death');
  });

  it('matches a live aura by id or by kind, and turns a seen aura into an entry', () => {
    const auras = [
      { id: 'x', kind: 'old_blood' },
      { id: 'hot_streak', kind: 'next_cast_free' },
    ];
    expect(findCooldownAura({ match: 'kind', value: 'old_blood' }, auras)?.id).toBe('x');
    expect(findCooldownAura({ match: 'id', value: 'hot_streak' }, auras)?.kind).toBe(
      'next_cast_free',
    );
    expect(findCooldownAura({ match: 'id', value: 'old_blood' }, auras)).toBeUndefined();
    expect(seenAuraEntry({ id: 'trinket_proc', kind: 'buff_ap', name: 'Fury' })).toMatchObject({
      token: 'aura:trinket_proc',
      category: 'seen',
      label: { type: 'sim', name: 'Fury' },
    });
  });
});
