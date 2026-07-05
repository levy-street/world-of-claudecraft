import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const localesDir = 'src/ui/i18n.locales';
// Keys introduced by the Delves port: match by path segment rather than an exhaustive list.
const prOnlyKey =
  /delve|lockpick|reliquary|brother_halven|collapsed_reliquary|acolyte|deacon|varric|tessa|halven|ossuary|saintless|bountiful|coffer|tumbler|delveUi|lockpickUi|sim\.delve|sim\.lockpick|entities\.delves|entities\.zones\.[^.]+\.pois\.(8|9)/i;

function extractEntries(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*["']([^"']+)["']:/);
    if (!m || !prOnlyKey.test(m[1])) continue;
    const block = [lines[i].trimEnd()];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^\s*["'][^"']+["']:/.test(next) || /^\s*\};?\s*$/.test(next)) break;
      i++;
      block.push(lines[i].trimEnd());
    }
    entries.push(block.join('\n').replace(/,\s*$/, ''));
  }
  return entries;
}

for (const file of fs.readdirSync(localesDir).filter((f) => f.endsWith('.ts'))) {
  const base = execSync(`git show release/v0.14.1:src/ui/i18n.locales/${file}`, {
    encoding: 'utf8',
  });
  const pr = execSync(`git show pr-848-delves:src/ui/i18n.locales/${file}`, { encoding: 'utf8' });
  const curPath = path.join(localesDir, file);
  let cur = base.replace(/\r\n/g, '\n');
  const prEntries = extractEntries(pr);
  const toAdd = prEntries.filter((block) => {
    const key = block.match(/^\s*["']([^"']+)["']:/);
    return key && !cur.includes(`'${key[1]}'`) && !cur.includes(`"${key[1]}"`);
  });
  if (!toAdd.length) {
    fs.writeFileSync(curPath, cur);
    continue;
  }
  const insertAt = cur.lastIndexOf('\n};');
  if (insertAt < 0) throw new Error(`Could not find overlay close in ${file}`);
  const body = toAdd.map((b) => `  ${b},`).join('\n');
  cur = `${cur.slice(0, insertAt)}\n${body}${cur.slice(insertAt)}`;
  fs.writeFileSync(curPath, cur);
  console.log(`${file}: +${toAdd.length}`);
}
