// The SFX Studio's cue groups (scripts/sfx_studio/cue_groups.mjs): the Group
// filter that lists the Smith's Heart's sounds, fight by fight, and the party
// pings. The static key lists in that module are pinned here against the code
// that actually plays them, so a cue the raid or the pings start using cannot
// quietly fall outside its group.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';
import {
  CUE_GROUPS,
  cueGroupSummary,
  cueGroupsFor,
  PING_CUES,
  SMITH_HEART_SHARED_CUES,
} from '../scripts/sfx_studio/cue_groups.mjs';
import { PING_SOUNDS } from '../src/ui/hud/pings/ping_feed_core';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG_KEYS: string[] = SFX.map((entry: { key: string }) => entry.key);
const HEART_KEYS = CATALOG_KEYS.filter((key) => key.startsWith('heart_'));
const FIGHT_GROUPS = [
  'smith_heart_council',
  'smith_heart_breath',
  'smith_heart_quench',
  'smith_heart_heat',
  'smith_heart_final',
  'smith_heart_marks',
];

/** Every catalog key a Smith's Heart audio module quotes, outside `heart_`. */
function sharedCuesTheRaidPlays(): string[] {
  const catalog = new Set(CATALOG_KEYS);
  const found = new Set<string>();
  const modules = tsFilesUnder(join(ROOT, 'src/game')).filter((source) =>
    /(^|\/)smith_heart_[a-z0-9_]+\.ts$/.test(source.file),
  );
  // A vacuity floor near the real count: the fight cores, their thin
  // consumers, the marks, the claims and the music.
  expect(modules.length).toBeGreaterThanOrEqual(12);
  for (const source of modules) {
    for (const match of readFileSync(source.full, 'utf8').matchAll(/['"`]([a-z0-9_]+)['"`]/g)) {
      const key = match[1] as string;
      if (catalog.has(key) && !key.startsWith('heart_')) found.add(key);
    }
  }
  return [...found].sort();
}

describe('SFX Studio cue groups', () => {
  it('files every raid cue under the whole raid and exactly one fight', () => {
    expect(HEART_KEYS.length).toBeGreaterThanOrEqual(130);
    for (const key of HEART_KEYS) {
      const groups = cueGroupsFor(key);
      expect(groups, key).toContain('smith_heart');
      expect(
        groups.filter((id) => FIGHT_GROUPS.includes(id)),
        key,
      ).toHaveLength(1);
    }
  });

  it('lists exactly the shared cues the raid audio modules play', () => {
    expect([...SMITH_HEART_SHARED_CUES].sort()).toEqual(sharedCuesTheRaidPlays());
    for (const key of SMITH_HEART_SHARED_CUES) {
      expect(cueGroupsFor(key), key).toEqual(
        expect.arrayContaining(['smith_heart', 'smith_heart_shared']),
      );
    }
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('lists exactly the party ping sounds', () => {
    const pingKeys = Object.values(PING_SOUNDS).map((sound) => sound.key);
    expect([...PING_CUES].sort()).toEqual([...pingKeys].sort());
    for (const key of PING_CUES) expect(cueGroupsFor(key), key).toContain('party_pings');
  });

  it('keeps unrelated cues out of every group', () => {
    for (const key of ['foot_grass', 'ui_click', 'mob_boar_attack', 'amb_rain'])
      expect(cueGroupsFor(key), key).toEqual([]);
  });

  it('summarizes each group with its live count, in dropdown order', () => {
    const summary = cueGroupSummary(CATALOG_KEYS);
    expect(summary.map((group) => group.id)).toEqual(CUE_GROUPS.map((group) => group.id));
    const count = (id: string) => summary.find((group) => group.id === id)?.count;
    expect(count('smith_heart')).toBe(HEART_KEYS.length + SMITH_HEART_SHARED_CUES.length);
    expect(FIGHT_GROUPS.reduce((sum, id) => sum + (count(id) ?? 0), 0)).toBe(HEART_KEYS.length);
    expect(count('party_pings')).toBe(PING_CUES.length);
    expect(cueGroupSummary(['foot_grass'])).toEqual([]);
  });
});
