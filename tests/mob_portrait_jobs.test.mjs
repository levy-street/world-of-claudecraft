import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildMobPortraitJobs } from '../scripts/lib/mob_portrait_jobs.mjs';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { MOBS } from '../src/sim/data';
import { targetPortraitUrl } from '../src/ui/target_portrait_view';

it('renders every live mob portrait except the four existing shared buddy headshots', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const jobs = await buildMobPortraitJobs(root);
  const ids = new Set(jobs.map((job) => job.mobId));
  const aliases = Object.keys(MOBS)
    .filter((id) => !ids.has(id))
    .sort();
  expect(aliases).toEqual(['buddy_crystal_lich', 'buddy_forgemaw', 'buddy_horse', 'buddy_sapling']);
  for (const id of aliases) {
    expect(targetPortraitUrl(id, true)).toBe(`/ui/portraits/${id}.webp`);
    expect(existsSync(new URL(`../public/ui/portraits/${id}.webp`, import.meta.url))).toBe(true);
  }
  expect(ids.size).toBe(jobs.length);
  for (const id of Object.keys(MOBS).filter((id) => !aliases.includes(id))) {
    expect(ids.has(id), id).toBe(true);
    expect(targetPortraitUrl(id, true)).toBe(`/ui/mobs/${id}.webp`);
  }
  for (const activity of FINDER_ACTIVITIES) {
    for (const { mobId } of activity.encounters) {
      expect(jobs.find((job) => job.mobId === mobId)?.finder, mobId).toBe(true);
    }
  }
});
