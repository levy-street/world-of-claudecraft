// In-game snapshots of boss attacks, set beside each attack's line on the boss page.
// scripts/wiki/render_attack_snapshots.mjs captures the frames and writes
// scripts/wiki/attack_snapshots.json: { mobId: { "<attack name as printed>": "/encyclopedia-attacks/x.webp" } }.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type TitleMaps = Partial<Record<string, Map<string, string>>>;

const SHOT = /^\/encyclopedia-attacks\/[\w.-]+\.webp$/;

/** Each boss page's attack snapshots, keyed by page title then attack name. Only shipped
 *  files are kept, so a missing frame leaves the line as plain text. */
export function attackShots(
  titleBy: TitleMaps,
  file = join('scripts', 'wiki', 'attack_snapshots.json'),
): Map<string, Map<string, string>> {
  const byMob: Record<string, Record<string, string>> = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : {};
  const result = new Map<string, Map<string, string>>();
  for (const [mobId, attacks] of Object.entries(byMob)) {
    const title = titleBy.mob?.get(mobId);
    if (!title) continue;
    const shots = new Map<string, string>();
    for (const [name, path] of Object.entries(attacks))
      if (SHOT.test(path) && existsSync(join('public', path.slice(1)))) shots.set(name, path);
    if (shots.size) result.set(title, shots);
  }
  return result;
}

/** Puts a snapshot at the start of every bullet that opens with an attack's name
 *  ("* Maul Arc. ..."), on both the Normal and Heroic copies of the encounter. */
export function withAttackShots(text: string, shots: Map<string, string>): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.startsWith('* ') || line.startsWith('* <woc-art')) return line;
      const body = line.slice(2);
      for (const [name, path] of shots)
        if (body.startsWith(name + '.'))
          return '* <woc-art path="' + path + '" size="attack" /> ' + body;
      return line;
    })
    .join('\n');
}
