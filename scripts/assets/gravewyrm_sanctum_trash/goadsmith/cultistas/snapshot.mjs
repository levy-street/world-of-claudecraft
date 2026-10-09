import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const key = process.argv[2],
  out = `E:/woc/entregas/santuario/trash/${key}`;
const fingerprint = JSON.parse(fs.readFileSync(`${out}/source_fingerprint.json`));
const refreshTools = process.argv.includes('--refresh-tools');
const refreshRenderer = process.argv.includes('--refresh-renderer');
for (const [file, sha] of Object.entries(fingerprint.files)) {
  const data = fs.readFileSync(refreshTools ? path.join(out, 'source', file) : file);
  assert.equal(
    createHash('sha256').update(data).digest('hex'),
    sha,
    `Source changed before freeze: ${file}`,
  );
  const dest = path.join(out, 'source', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}
console.log('AUTHORING SNAPSHOT', key, Object.keys(fingerprint.files).length);
const tools = {};
for (const name of fs
  .readdirSync('scripts/anim/cultistas')
  .filter((n) => /\.(py|mjs|ps1)$/.test(n))) {
  const source = `scripts/anim/cultistas/${name}`;
  const dest = path.join(out, 'source', source);
  if (refreshRenderer && name === 'render.py' && fs.existsSync(dest)) {
    const previous = fs.readFileSync(dest);
    const sha = createHash('sha256').update(previous).digest('hex');
    const archive = path.join(out, 'source/media_renderers', `${sha}.py`);
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(archive, previous);
  }
  const preserve =
    refreshTools &&
    (name.endsWith('.py') || name === 'validate_export.mjs') &&
    !(refreshRenderer && name === 'render.py');
  const data = fs.readFileSync(preserve ? dest : source);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  tools[source] = createHash('sha256').update(data).digest('hex');
}
const archives = path.join(out, 'source/media_renderers');
if (fs.existsSync(archives))
  for (const name of fs.readdirSync(archives))
    tools[`media_renderers/${name}`] = createHash('sha256')
      .update(fs.readFileSync(path.join(archives, name)))
      .digest('hex');
fs.writeFileSync(`${out}/source/tools_fingerprint.json`, JSON.stringify(tools, null, 2));
