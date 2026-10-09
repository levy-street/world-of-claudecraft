import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const key = process.argv[2],
  out = `E:/woc/entregas/santuario/trash/${key}`;
const read = (n) => JSON.parse(fs.readFileSync(`${out}/${n}.json`));
const hash = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const native = read('native_validation'),
  exported = read('export_validation'),
  webgl = read('webgl_validation'),
  videos = read('video_validation'),
  metrics = read('source_metrics');
const art = read('art_review');
assert.equal(art.status, 'ACCEPTED');
assert.equal(art.model_sha256, hash(`${out}/${key}.blend`));
assert.equal(art.glb_sha256, hash(`${out}/${key}.glb`));
assert(art.rounds.length >= 2 && art.rounds.length <= 3);
for (const round of art.rounds)
  for (const file of round.images) assert(fs.existsSync(`${out}/${file}`));
for (const proof of [native, exported, webgl]) assert.equal(proof.status, 'PASS');
assert.equal(exported.model_sha256, hash(`${out}/${key}.blend`));
assert.equal(exported.glb_sha256, hash(`${out}/${key}.glb`));
assert.equal(webgl.glb_sha256, exported.glb_sha256);
assert.equal(native.model_sha256, exported.model_sha256);
assert.equal(webgl.viewer_sha256, hash(`${out}/viewer.html`));
assert.equal(
  native.validator_sha256,
  hash(`${out}/source/scripts/anim/cultistas/validate_native.py`),
);
assert.equal(
  exported.validator_sha256,
  hash(`${out}/source/scripts/anim/cultistas/validate_export.mjs`),
);
const frozen = JSON.parse(fs.readFileSync(`${out}/source/tools_fingerprint.json`));
for (const [name, sha] of Object.entries(frozen)) assert.equal(hash(`${out}/source/${name}`), sha);
assert.deepEqual(videos.map((v) => v.name).sort(), Object.keys(metrics.clips).sort());
for (const v of videos) {
  assert.equal(v.decode, 'PASS');
  assert.equal(v.model_sha256, exported.model_sha256);
  assert.equal(v.video_sha256, hash(`${out}/previews/${v.name}.mp4`));
  const currentRenderer = `${out}/source/scripts/anim/cultistas/render.py`;
  const archivedRenderer = `${out}/source/media_renderers/${v.renderer_sha256}.py`;
  assert(
    hash(currentRenderer) === v.renderer_sha256 ||
      (fs.existsSync(archivedRenderer) && hash(archivedRenderer) === v.renderer_sha256),
    `Missing exact renderer source for ${v.name}`,
  );
}
const images = fs.readdirSync(`${out}/renders`).filter((n) => n.endsWith('.png'));
assert.deepEqual(images.slice().sort(), [
  'back.png',
  'front.png',
  'head.png',
  'hero.png',
  'scale_knight.png',
  'side.png',
]);
for (const n of images) {
  const proof = JSON.parse(fs.readFileSync(`${out}/renders/${n.replace('.png', '.json')}`));
  assert.equal(proof.model_sha256, exported.model_sha256);
  assert.equal(proof.image_sha256, hash(`${out}/renders/${n}`));
  if (n !== 'head.png') {
    assert.equal(proof.framing_bounds?.length, 4);
    const [left, bottom, right, top] = proof.framing_bounds;
    assert(left >= 0.045 && bottom >= 0.045 && right <= 0.955 && top <= 0.955);
  }
}
const params = {
  thawcaller: {
    title: 'Broodsworn Thawcaller',
    scale: 1.6,
    height: 4.4,
    abilities: { sanctum_warming_rite: 'WarmingRite' },
    anchors: ['Socket_Grip_R', 'Socket_Grip_L', 'Socket_Lantern'],
  },
  goadsmith: {
    title: 'Broodsworn Goadsmith',
    scale: 1.75,
    height: 4.6,
    abilities: { sanctum_goad: 'Goad', sanctum_goadsmith_rerivet: 'ReRivet' },
    anchors: ['Socket_Grip_R', 'Socket_GoadTip'],
  },
  pyre_tender: {
    title: 'Broodsworn Pyre-Tender',
    scale: 1.65,
    height: 4.4,
    abilities: { sanctum_plant_brazier: 'PlantBrazier' },
    anchors: ['Socket_Grip_L', 'Socket_Grip_R', 'Socket_Brazier_L', 'Socket_Brazier_R'],
  },
}[key];
const ratio = params.height / exported.normalization.raw_height;
const map = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: key === 'thawcaller' ? ['Attack', 'Attack2'] : ['Attack'],
  hit: ['Hit'],
  death: 'Death',
  cast: 'Cast',
  castByAbility: params.abilities,
  castTimeScaleByAbility: Object.fromEntries(Object.keys(params.abilities).map((id) => [id, 1])),
  castPlayOut: Object.values(params.abilities),
};
const integration = {
  height: params.height / params.scale,
  hover: 0,
  deathGroundOffset: 0,
  walkRef: 1.125 * ratio,
  runRef: 4.5 * ratio,
  walkTimeScaleMax: (7 / (1.125 * ratio)) * 1.05,
  runTimeScaleMax: (7 / (4.5 * ratio)) * 1.05,
  runTimeScaleMin: 0,
  attackTimeScale: 1,
  deathTimeScale: 1,
  authoredAtlas: true,
  castClipSync: true,
  castPlayOutHoldsAttacks: true,
  clips: map,
};
fs.writeFileSync(`${out}/integration.json`, JSON.stringify(integration, null, 2));
const table = Object.entries(metrics.clips)
  .map(
    ([n, t]) =>
      `| ${n} | ${t} | ${metrics.contacts[n] ?? ''} | ${['Idle', 'Walk', 'Run', 'Cast'].includes(n) ? 'loop' : 'one-shot'} |`,
  )
  .join('\n');
const notes = `# ${params.title}

Modelo original creado en Blender para el deshielo del Santuario. Geometría,
texturas y poses propias; no usa mallas ni animaciones prestadas. El caballero
KayKit conserva su malla y atlas CC0 y solo aparece como referencia de escala.
Los Broodsworn son cultistas del Gravecaller que intentan liberar a Korzul
del glaciar de Thornpeak. El equipo mezcla pieles, hollín, hielo y almas cautivas.

Entrega: ${key}.blend, ${key}.raw.glb, ${key}.glb, galería, visor 3D sin servidor,
renders y vídeo de cada clip. Tres rondas de revisión, con imágenes conservadas.
Las fuentes de cada modelo están congeladas en source/ para poder reproducir
su versión aunque el siguiente cultista refine las herramientas compartidas.
Si hay source/media_renderers/, conserva versiones anteriores del renderer
identificadas por SHA para reproducir vídeos previos al ajuste de encuadres.
Para usarlas, restaurar esa copia como scripts/anim/cultistas/render.py.

${exported.triangles} triángulos; ${exported.bytes} bytes; ${exported.materials}
materiales; ${exported.textures} texturas KTX2. Compresión de geometría Meshopt
sin simplificación del skin. Atlas originales PNG empaquetados en Blender.
Las llamas de los accesorios son geometría emisiva; el humo y las partículas
de combate pertenecen al renderer. El brasero plantado es una entidad aparte.

Validación: poses nativas a 60 Hz, continuidad de rotaciones y bucles, codos
flexionados en Idle, vértices rígidos de manos/accesorios, suelo y puntos de
suela durante el apoyo; paridad de geometría nativa/raw/optimizada; carga KTX2
en WebGL; FFmpeg decodifica todos los vídeos. Khronos: ${exported.khronos_errors}
errores y ${exported.khronos_warnings} advertencias (véase informe).
El validador empleado no reconoce image/ktx2; también advierte de las mallas
skinned bajo el nodo del rig. La carga real KTX2 y la paridad de poses se
comprueban por separado sobre los bytes entregados.
Revisión visual por imágenes y contactos; no se presenta la reproducción
automática como una crítica humana de todos los fotogramas.

## Integration (English)

Keep template broodsworn_${key} and visual key sanctum_${key}. Replace the entire
placeholder VisualDef. Do not inherit old animUrls, show lists, tints, weapon
attachments or Bastion Ward overrides. This GLB contains its own props and rig.
Use integration.json as the explicit clip and scale map, adding the final URL.

Native height: ${native.height.toFixed(6)} yd, versus the 2.6 yd KayKit knight.
Placement uses the skinned Idle pose at 0.5 s, matching prepareVisual. Exported
normalization height: ${exported.normalization.raw_height.toFixed(6)} yd. Worst
normalized ground minimum: ${exported.normalization.min_ground_world.toFixed(6)} yd.
Desired drawn height: ${params.height} yd. Existing entity scale: ${params.scale}.
VisualDef.height: ${(params.height / params.scale).toFixed(9)}. Do not apply entity
scale twice. The renderer normalizes the asset before applying template scale.
Blender: Z up, -Y forward. Export: Y up, +Z forward. Ground pivot at XZ=(0,0).

Gaits are in-place. Native Walk speed: 1.125 yd/s; Run: 4.5 yd/s. At the target
drawn scale use walkRef=${integration.walkRef.toFixed(6)} and runRef=${integration.runRef.toFixed(6)}.
The simulation's moveSpeed is 7; runtime time-scaling must match forward motion.
Explicit cadence ceilings cover movement up to 7 yd/s, including the 2.8 yd/s
patrol pace. Run has no configured minimum cadence. The current renderer
hard-clamps Walk to 0.6x (below ${(integration.walkRef * 0.6).toFixed(6)} yd/s here)
and uses movement hysteresis and smoothed speed. Very slow movement and start/
stop transitions can therefore retain foot sliding. Eliminating that across
the full speed range requires a runtime change; there is no walkTimeScaleMin
field in the reviewed snapshot. The native constant-speed support checks pass.
Do not play an in-place gait on a stationary unit and interpret its support
travel as an authored slide. Idle/casts/attacks keep their foot supports fixed.

Native timeline: 30 fps with half-frame keys, sampled at 60 Hz for GLB export.
Contact frames below are 1-based native frame numbers: seconds=(frame-1)/30.

| Clip | Seconds | Contact frame | Mode |
|---|---:|---:|---|
${table}

Ability mappings: ${JSON.stringify(params.abilities)}.
${key === 'goadsmith' ? 'Goad and ReRivet intentionally share the iron-channeling gesture; their contact times and hold durations differ (2 s versus 6 s).' : ''}
Set castClipSync=true, castPlayOutHoldsAttacks=true, castTimeScaleByAbility=1
for each mapped ability and castPlayOut to the dedicated clip names. Use
contact-time / bar-duration, not full-clip-duration / bar-duration. Do not set
castHoldPointSeconds for these clips. Attack and Death rates are explicitly 1.
The recovery tail may be interrupted by movement or another active state.
Current renderer sync corrects drift over 0.12 s; it is not frame-exact.
Current cast play-out does not distinguish an interrupted cast from a success;
an integration follow-up must cancel the contact gesture after a kick.

Bones: ${exported.bones.join(', ')}.
Relevant anchors: ${params.anchors.join(', ')}. Read animated world transforms
each frame. The existing Sanctum FX use body offsets, not these sockets; adding
sockets to the GLB alone does not make those effects follow the animated prop.
Wire the lantern smoke, goad sparks and brazier flames to the appropriate sockets
when integrating. Props are already skinned into this asset; attach no second copy.

This is an asset-only delivery. No runtime source, simulation, public assets or
manifest was edited. No full game gate, push or PR. Local asset checks and source
commits are recorded separately. Creature count and existing encounter behavior
are unchanged by this delivery.
`;
fs.writeFileSync(`${out}/NOTAS.md`, notes);
const cards = images
  .map(
    (n) =>
      `<figure><a href="renders/${n}"><img loading="lazy" src="renders/${n}" alt="${n}"></a><figcaption>${n}</figcaption></figure>`,
  )
  .join('');
const movies = videos
  .map(
    (v) =>
      `<figure><video controls preload="metadata" poster="contact_sheets/${v.name}.png" src="previews/${v.name}.mp4"></video><figcaption>${v.name} · ${v.seconds} s</figcaption></figure>`,
  )
  .join('');
fs.writeFileSync(
  `${out}/index.html`,
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${params.title}</title><style>body{background:#101c25;color:#dce9ed;font:16px/1.6 system-ui;margin:24px}main{max-width:1350px;margin:auto}a{color:#83deef}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px}figure{margin:0;background:#20303b}img,video{width:100%;display:block}figcaption{padding:8px}</style><main><h1>${params.title}</h1><p>Modelo original, ${exported.triangles} triángulos. Las animaciones y texturas KTX2 se pueden revisar en el visor.</p><p><a href="viewer.html">Visor 3D</a> · <a href="${key}.blend">Blender</a> · <a href="${key}.glb">GLB optimizado</a> · <a href="${key}.raw.glb">GLB raw</a> · <a href="NOTAS.md">Notas e integración</a></p><h2>Renders junto al caballero</h2><div class="grid">${cards}</div><h2>Todos los clips</h2><div class="grid">${movies}</div></main></html>`,
);
const scan = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? scan(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = scan(out).filter((f) => !f.endsWith('checksums.json') && !f.endsWith('.blend1'));
fs.writeFileSync(
  `${out}/checksums.json`,
  JSON.stringify(
    Object.fromEntries(files.map((f) => [path.relative(out, f).replaceAll('\\', '/'), hash(f)])),
    null,
    2,
  ),
);
console.log('HANDOFF', key, images.length, videos.length);
