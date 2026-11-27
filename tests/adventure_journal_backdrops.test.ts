// The Adventure Journal's banner backdrops (src/ui/hud/journal/journal_backdrop_view.ts):
// every picture the table names is a committed WebP under public/ui/journal/,
// every committed file there is named by the table (no orphan ships), each stays
// a small file, the Smith's Heart's five pages each have their own room, and a
// page with no picture keeps the plain banner.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import {
  JOURNAL_BACKDROP_DIR,
  journalBackdropFiles,
  journalBackdropUrl,
} from '../src/ui/hud/journal/journal_backdrop_view';
import { journalInstance } from '../src/ui/hud/journal/journal_catalog';

const DIR = join(import.meta.dirname, '..', 'public', 'ui', 'journal');

describe('Adventure Journal banner backdrops', () => {
  it('names exactly the committed files, both ways', () => {
    const committed = readdirSync(DIR)
      .filter((f) => !f.startsWith('.'))
      .sort();
    expect(committed).toEqual(journalBackdropFiles());
  });

  it('keeps every picture a small real WebP', () => {
    for (const file of journalBackdropFiles()) {
      const bytes = readFileSync(join(DIR, file));
      expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1'), file).toBe('WEBP');
      const size = statSync(join(DIR, file)).size;
      expect(size, file).toBeGreaterThan(20 * 1024);
      expect(size, file).toBeLessThanOrEqual(130 * 1024);
    }
  });

  it("gives each Smith's Heart page its own room", () => {
    const heart = journalInstance(SMITH_HEART_DUNGEON);
    expect(heart).not.toBeNull();
    const urls = heart!.source.bossKeys.map((key) => journalBackdropUrl(SMITH_HEART_DUNGEON, key));
    expect(urls.every((url) => url?.startsWith(JOURNAL_BACKDROP_DIR))).toBe(true);
    expect(new Set(urls).size).toBe(heart!.source.bossKeys.length);
  });

  it('leaves a page with no picture on the plain banner', () => {
    expect(journalBackdropUrl('gravewyrm_sanctum', 'korzul_the_gravewyrm')).toBeNull();
    expect(journalBackdropUrl(SMITH_HEART_DUNGEON, 'not_a_boss')).toBeNull();
    expect(journalBackdropUrl('toString', 'valueOf')).toBeNull();
  });
});
