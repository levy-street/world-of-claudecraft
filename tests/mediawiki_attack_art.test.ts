import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attackShots, withAttackShots } from '../scripts/mediawiki/attack_art';

describe('Encyclopedia boss attack snapshots', () => {
  const shots = new Map([
    ['Maul Arc', '/encyclopedia-attacks/korgath__maul_arc.webp'],
    ["Foreman's Bellow", '/encyclopedia-attacks/korgath__bellow.webp'],
  ]);

  it('puts a snapshot on every bullet that opens with an attack name, on both tiers', () => {
    const text = [
      '== Normal encounter ==',
      '* Maul Arc. A cleave in front of him.',
      "* Foreman's Bellow. Hits everyone.",
      '* tank: Keep Maul Arc. away from the group.',
      'Maul Arc. is not a bullet.',
      '== Heroic encounter ==',
      '* Maul Arc. A bigger cleave.',
    ].join('\n');
    const out = withAttackShots(text, shots).split('\n');
    expect(out[1]).toBe(
      '* <woc-art path="/encyclopedia-attacks/korgath__maul_arc.webp" size="attack" /> Maul Arc. A cleave in front of him.',
    );
    expect(out[2]).toContain('korgath__bellow.webp');
    // Only a line that opens with the name is an attack line.
    expect(out[3]).toBe('* tank: Keep Maul Arc. away from the group.');
    expect(out[4]).toBe('Maul Arc. is not a bullet.');
    expect(out[6]).toContain('korgath__maul_arc.webp');
  });

  it('does not match a longer name that only starts the same way', () => {
    const out = withAttackShots('* Maul Arcade. Not this one.', shots);
    expect(out).toBe('* Maul Arcade. Not this one.');
  });

  it('is idempotent', () => {
    const once = withAttackShots('* Maul Arc. Cleave.', shots);
    expect(withAttackShots(once, shots)).toBe(once);
  });

  it('keeps only shipped, well-formed frames and maps mob ids to page titles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'attack-shots-'));
    const file = join(dir, 'shots.json');
    writeFileSync(
      file,
      JSON.stringify({
        korgath: {
          Missing: '/encyclopedia-attacks/does_not_exist.webp',
          Outside: '/ui/items/copper_ore.webp',
        },
        unknown_mob: { Anything: '/encyclopedia-attacks/x.webp' },
      }),
    );
    const result = attackShots({ mob: new Map([['korgath', 'Korgath (Mob)']]) }, file);
    expect(result.size).toBe(0);
  });

  it('only references files that exist for the committed manifest', () => {
    const result = attackShots({
      mob: new Map(
        Object.keys(JSON.parse(readFileSync('scripts/wiki/attack_snapshots.json', 'utf8'))).map(
          (id) => [id, id],
        ),
      ),
    });
    for (const shotsByName of result.values())
      for (const path of shotsByName.values())
        expect(path).toMatch(/^\/encyclopedia-attacks\/[\w.-]+\.webp$/);
  });
});

describe('Encyclopedia reader attack snapshots', () => {
  it('draws the snapshot beside the line and allows the folder in MediaWiki', () => {
    expect(readFileSync('mediawiki/reader/reader.js', 'utf8')).toContain(
      '<img class="attack-shot" data-game-art="',
    );
    const php = readFileSync('mediawiki/LocalSettings.php', 'utf8');
    expect(php).toContain('encyclopedia-attacks');
    expect(php).toContain("'attack' => 'woc-attack-art'");
    expect(readFileSync('mediawiki/Dockerfile', 'utf8')).toContain('public/encyclopedia-attacks/');
  });
});
