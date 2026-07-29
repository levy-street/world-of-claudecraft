import { beforeEach, describe, expect, it } from 'vitest';
import { loadCharselectNews } from '../src/ui/charselect_news';
import type { NewsReleaseEntry } from '../src/ui/news_feed';

// Plain-Node suite (tests/CLAUDE.md two-branch DOM rule): the painter only
// touches host.innerHTML and a Storage, so a tiny fake of each is enough.
class FakeHost {
  innerHTML = '';
}

class FakeStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const LAST_SEEN_KEY = 'woc.welcome.lastSeenReleaseId';

function release(id: number): NewsReleaseEntry {
  return {
    id,
    tag: `v${id}.0.0`,
    name: `v${id}.0.0`,
    body: `notes for ${id}`,
    url: `https://example.com/releases/${id}`,
    prerelease: false,
    publishedAt: '2026-07-01T00:00:00Z',
  };
}

let host: FakeHost;
let storage: FakeStorage;

beforeEach(() => {
  host = new FakeHost();
  storage = new FakeStorage();
});

const load = (fetchReleases: () => Promise<NewsReleaseEntry[]>) =>
  loadCharselectNews(host as unknown as HTMLElement, fetchReleases, storage as unknown as Storage);

describe('loadCharselectNews', () => {
  it('paints the compact feed: latest expanded, older collapsed, view-all link', async () => {
    await load(async () => [release(3), release(2), release(1)]);
    expect(host.innerHTML).toContain('news-item');
    expect(host.innerHTML).toContain('notes for 3');
    expect((host.innerHTML.match(/<details class="news-collapsed">/g) ?? []).length).toBe(2);
    expect(host.innerHTML).toContain('news-view-all');
  });

  it('marks every release NEW on a first-ever visit and advances the marker', async () => {
    await load(async () => [release(3), release(2)]);
    expect((host.innerHTML.match(/news-badge/g) ?? []).length).toBe(2);
    expect(storage.getItem(LAST_SEEN_KEY)).toBe('3');
  });

  it('badges only releases newer than the stored last-seen marker', async () => {
    storage.setItem(LAST_SEEN_KEY, '2');
    await load(async () => [release(3), release(2)]);
    expect((host.innerHTML.match(/news-badge/g) ?? []).length).toBe(1);
    expect(storage.getItem(LAST_SEEN_KEY)).toBe('3');
  });

  it('never moves the last-seen marker backwards', async () => {
    storage.setItem(LAST_SEEN_KEY, '9');
    await load(async () => [release(3)]);
    expect(storage.getItem(LAST_SEEN_KEY)).toBe('9');
  });

  it('paints the error state and leaves the marker untouched when the fetch rejects', async () => {
    storage.setItem(LAST_SEEN_KEY, '2');
    await load(async () => {
      throw new Error('network');
    });
    expect(host.innerHTML).toContain('news-error');
    expect(storage.getItem(LAST_SEEN_KEY)).toBe('2');
  });

  it('paints the empty state when there are no releases', async () => {
    await load(async () => []);
    expect(host.innerHTML).toContain('news-empty');
  });

  it('is a no-op with a null host', async () => {
    await expect(
      loadCharselectNews(null, async () => [], storage as unknown as Storage),
    ).resolves.toBeUndefined();
  });

  it('drops a stale in-flight load: the newest charselect entry wins the paint', async () => {
    let resolveSlow: (r: NewsReleaseEntry[]) => void = () => {};
    const slow = new Promise<NewsReleaseEntry[]>((r) => {
      resolveSlow = r;
    });
    const first = load(() => slow);
    await load(async () => [release(9)]);
    expect(host.innerHTML).toContain('notes for 9');
    resolveSlow([release(1)]);
    await first;
    // The stale result must not clobber the newer paint (and a hung fetch must
    // never block future loads, unlike an in-flight boolean gate would).
    expect(host.innerHTML).toContain('notes for 9');
    expect(host.innerHTML).not.toContain('notes for 1');
  });

  it('still paints, with everything NEW, when storage is unavailable', async () => {
    const throwing = {
      getItem() {
        throw new Error('storage disabled');
      },
      setItem() {
        throw new Error('storage disabled');
      },
    };
    await loadCharselectNews(
      host as unknown as HTMLElement,
      async () => [release(3), release(2)],
      throwing as unknown as Storage,
    );
    expect(host.innerHTML).toContain('notes for 3');
    expect((host.innerHTML.match(/news-badge/g) ?? []).length).toBe(2);
  });
});
