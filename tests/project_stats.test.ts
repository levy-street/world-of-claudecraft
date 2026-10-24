// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadProjectStats,
  type ProjectStats,
  STATS_CACHE_KEY,
  STATS_CACHE_TTL_MS,
} from '../src/ui/project_stats';

const stats = (characters: number): ProjectStats => ({
  accounts_created: 1,
  characters_created: characters,
  players_online: 2,
  realm: 'Claudemoon',
});

function counters(): string[] {
  return [...document.querySelectorAll('.js-stat-characters')].map((el) => el.textContent ?? '');
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML =
    '<span class="js-stat-characters">…</span><span class="js-stat-characters">…</span>';
});

describe('loadProjectStats', () => {
  it('uses a fresh cache entry without fetching', async () => {
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ ...stats(5), timestamp: Date.now() }));
    const fetchStats = vi.fn(async () => stats(9));
    await loadProjectStats(fetchStats);
    expect(fetchStats).not.toHaveBeenCalled();
    expect(counters()).toEqual(['5', '5']);
  });

  it('fetches past the cache window and caches the answer', async () => {
    localStorage.setItem(
      STATS_CACHE_KEY,
      JSON.stringify({ ...stats(5), timestamp: Date.now() - STATS_CACHE_TTL_MS - 1 }),
    );
    await loadProjectStats(async () => stats(9));
    expect(counters()).toEqual(['9', '9']);
    expect(JSON.parse(localStorage.getItem(STATS_CACHE_KEY) ?? '{}').characters_created).toBe(9);
  });

  it('falls back to a stale entry, then to a dash, when the fetch fails', async () => {
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ ...stats(5), timestamp: 0 }));
    await loadProjectStats(async () => Promise.reject(new Error('down')));
    expect(counters()).toEqual(['5', '5']);
    localStorage.clear();
    await loadProjectStats(async () => Promise.reject(new Error('down')));
    expect(counters()).toEqual(['-', '-']);
  });

  it('does nothing on a page without the counter', async () => {
    document.body.innerHTML = '';
    const fetchStats = vi.fn(async () => stats(9));
    await loadProjectStats(fetchStats);
    expect(fetchStats).not.toHaveBeenCalled();
  });
});
