import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { assertExactlyOneItemIconOwner, itemIconOwnershipIndex } from './item_icon_intake.mjs';

export const ITEM_ART_AUDIT_MODES = Object.freeze([
  '128-color',
  '40-color',
  '28-color',
  '22-color',
  '28-grayscale',
  '64-circle',
  'small-multiview',
  'identity',
]);

export const ITEM_ART_AUDIT_REVIEW_MODES = Object.freeze([
  '128-color',
  '40-color',
  '28-color',
  '22-color',
  '28-grayscale',
  '64-circle',
  'small-multiview',
  'identity-display-name-and-id',
]);

const SINGLE_PREVIEW_MODES = ITEM_ART_AUDIT_MODES.slice(0, 6);
const MAXIMUM_SHIPPING_BYTES = 15 * 1024;
const IDS_PER_PAGE = 80;
const COLUMNS = 10;
const PNG_OPTIONS = Object.freeze({
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const posixRelative = (root, target) => path.relative(root, target).split(path.sep).join('/');

function resolveInside(root, relativePath, label) {
  assert.equal(
    path.isAbsolute(relativePath),
    false,
    `${label} must be relative to the repository root`,
  );
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  assert(
    relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`),
    `${label} must resolve inside the repository root`,
  );
  return target;
}

const escapeXml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function wrapWords(words, joiner, maximum) {
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current.length === 0 ? word : `${current}${joiner}${word}`;
    if (next.length <= maximum || current.length === 0) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  return [
    lines[0],
    `${lines
      .slice(1)
      .join(joiner)
      .slice(0, maximum - 3)}...`,
  ];
}

const idLines = (id, maximum = 25) => wrapWords(id.split('_'), '_', maximum);

const nameLines = (name, maximum = 25) => wrapWords(name.split(/\s+/), ' ', maximum);

function plannedSheetPath(relativeSheetDirectory, group, page, mode) {
  return `${relativeSheetDirectory}/${group}--p${String(page).padStart(2, '0')}--${mode}.png`;
}

function textSvg(width, height, lines, y, size = 10) {
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${width / 2}" dy="${index === 0 ? 0 : size + 2}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="${width / 2}" y="${y}" text-anchor="middle" font-family="monospace" font-size="${size}" fill="#e7dfcf">${tspans}</text></svg>`,
  );
}

function headerSvg(width, title) {
  return Buffer.from(
    `<svg width="${width}" height="44" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#17171d"/><text x="16" y="28" font-family="monospace" font-size="17" fill="#f4ead8">${escapeXml(title)}</text></svg>`,
  );
}

export async function renderItemArtAuditPreview(pathname, mode) {
  if (mode === '128-color') {
    return {
      buffer: await sharp(pathname)
        .resize(128, 128, { fit: 'fill', kernel: 'lanczos3' })
        .png(PNG_OPTIONS)
        .toBuffer(),
      width: 128,
      height: 128,
    };
  }
  if (mode === '40-color') {
    const tiny = await sharp(pathname)
      .resize(40, 40, { fit: 'fill', kernel: 'lanczos3' })
      .png(PNG_OPTIONS)
      .toBuffer();
    const buffer = await sharp(tiny)
      .resize(80, 80, { fit: 'fill', kernel: 'nearest' })
      .png(PNG_OPTIONS)
      .toBuffer();
    return { buffer, width: 80, height: 80 };
  }
  if (mode === '28-color') {
    const tiny = await sharp(pathname)
      .resize(28, 28, { fit: 'fill', kernel: 'lanczos3' })
      .png(PNG_OPTIONS)
      .toBuffer();
    const buffer = await sharp(tiny)
      .resize(112, 112, { fit: 'fill', kernel: 'nearest' })
      .png(PNG_OPTIONS)
      .toBuffer();
    return { buffer, width: 112, height: 112 };
  }
  if (mode === '22-color') {
    const tiny = await sharp(pathname)
      .resize(22, 22, { fit: 'fill', kernel: 'lanczos3' })
      .png(PNG_OPTIONS)
      .toBuffer();
    const buffer = await sharp(tiny)
      .resize(110, 110, { fit: 'fill', kernel: 'nearest' })
      .png(PNG_OPTIONS)
      .toBuffer();
    return { buffer, width: 110, height: 110 };
  }
  if (mode === '28-grayscale') {
    const tiny = await sharp(pathname)
      .resize(28, 28, { fit: 'fill', kernel: 'lanczos3' })
      .greyscale()
      .png(PNG_OPTIONS)
      .toBuffer();
    const buffer = await sharp(tiny)
      .resize(112, 112, { fit: 'fill', kernel: 'nearest' })
      .png(PNG_OPTIONS)
      .toBuffer();
    return { buffer, width: 112, height: 112 };
  }
  assert.equal(mode, '64-circle', `Unsupported single-preview mode: ${mode}`);
  const mask = Buffer.from(
    '<svg width="64" height="64"><circle cx="32" cy="32" r="31" fill="white"/></svg>',
  );
  const circle = await sharp(pathname)
    .resize(64, 64, { fit: 'fill', kernel: 'lanczos3' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png(PNG_OPTIONS)
    .toBuffer();
  const buffer = await sharp(circle)
    .resize(128, 128, { fit: 'fill', kernel: 'nearest' })
    .png(PNG_OPTIONS)
    .toBuffer();
  return { buffer, width: 128, height: 128 };
}

async function modeSheet(sheetDirectory, relativeSheetDirectory, group, page, records, mode) {
  const cellWidth = 160;
  const imageArea = mode === '40-color' ? 88 : 132;
  const cellHeight = imageArea + 34;
  const rows = Math.ceil(records.length / COLUMNS);
  const width = COLUMNS * cellWidth;
  const height = 44 + rows * cellHeight;
  const composites = [
    {
      input: headerSvg(width, `${group} | page ${page} | ${mode} | ${records.length} assets`),
      left: 0,
      top: 0,
    },
  ];
  for (const [index, record] of records.entries()) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const cellLeft = column * cellWidth;
    const cellTop = 44 + row * cellHeight;
    const rendered = await renderItemArtAuditPreview(record.absolutePath, mode);
    composites.push({
      input: rendered.buffer,
      left: cellLeft + Math.floor((cellWidth - rendered.width) / 2),
      top: cellTop + Math.floor((imageArea - rendered.height) / 2),
    });
    composites.push({
      input: textSvg(cellWidth, 34, idLines(record.id), 11, 9),
      left: cellLeft,
      top: cellTop + imageArea,
    });
  }
  const basename = `${group}--p${String(page).padStart(2, '0')}--${mode}.png`;
  await sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 20, b: 25, alpha: 1 } },
  })
    .composite(composites)
    .png(PNG_OPTIONS)
    .toFile(path.join(sheetDirectory, basename));
  return `${relativeSheetDirectory}/${basename}`;
}

async function smallMultiviewSheet(sheetDirectory, relativeSheetDirectory, group, page, records) {
  const cellWidth = 180;
  const cellHeight = 218;
  const rows = Math.ceil(records.length / COLUMNS);
  const width = COLUMNS * cellWidth;
  const height = 44 + rows * cellHeight;
  const composites = [
    {
      input: headerSvg(
        width,
        `${group} | page ${page} | small multiview: 40, 28, gray 28, circle 64 | ${records.length} assets`,
      ),
      left: 0,
      top: 0,
    },
  ];
  const modeLayout = [
    { mode: '40-color', left: 6, top: 4, display: 80 },
    { mode: '28-color', left: 91, top: 2, display: 84 },
    { mode: '28-grayscale', left: 6, top: 92, display: 84 },
    { mode: '64-circle', left: 96, top: 92, display: 64 },
  ];
  for (const [index, record] of records.entries()) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const cellLeft = column * cellWidth;
    const cellTop = 44 + row * cellHeight;
    for (const entry of modeLayout) {
      const rendered = await renderItemArtAuditPreview(record.absolutePath, entry.mode);
      const target =
        rendered.width === entry.display
          ? rendered.buffer
          : await sharp(rendered.buffer)
              .resize(entry.display, entry.display, { kernel: 'nearest' })
              .png(PNG_OPTIONS)
              .toBuffer();
      composites.push({ input: target, left: cellLeft + entry.left, top: cellTop + entry.top });
    }
    composites.push({
      input: textSvg(cellWidth, 38, idLines(record.id), 12, 9),
      left: cellLeft,
      top: cellTop + 178,
    });
  }
  const basename = `${group}--p${String(page).padStart(2, '0')}--small-multiview.png`;
  await sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 20, b: 25, alpha: 1 } },
  })
    .composite(composites)
    .png(PNG_OPTIONS)
    .toFile(path.join(sheetDirectory, basename));
  return `${relativeSheetDirectory}/${basename}`;
}

async function identitySheet(sheetDirectory, relativeSheetDirectory, group, page, records) {
  const cellWidth = 180;
  const imageArea = 132;
  const labelHeight = 72;
  const cellHeight = imageArea + labelHeight;
  const rows = Math.ceil(records.length / COLUMNS);
  const width = COLUMNS * cellWidth;
  const height = 44 + rows * cellHeight;
  const composites = [
    {
      input: headerSvg(
        width,
        `${group} | page ${page} | identity: live display name + internal id | ${records.length} assets`,
      ),
      left: 0,
      top: 0,
    },
  ];
  for (const [index, record] of records.entries()) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const cellLeft = column * cellWidth;
    const cellTop = 44 + row * cellHeight;
    const rendered = await renderItemArtAuditPreview(record.absolutePath, '128-color');
    composites.push({
      input: rendered.buffer,
      left: cellLeft + Math.floor((cellWidth - rendered.width) / 2),
      top: cellTop,
    });
    composites.push({
      input: textSvg(cellWidth, 34, idLines(record.id), 11, 9),
      left: cellLeft,
      top: cellTop + imageArea,
    });
    composites.push({
      input: textSvg(cellWidth, 34, nameLines(record.name), 11, 9),
      left: cellLeft,
      top: cellTop + imageArea + 34,
    });
  }
  const basename = `${group}--p${String(page).padStart(2, '0')}--identity.png`;
  await sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 20, b: 25, alpha: 1 } },
  })
    .composite(composites)
    .png(PNG_OPTIONS)
    .toFile(path.join(sheetDirectory, basename));
  return `${relativeSheetDirectory}/${basename}`;
}

function groupFor(id, items) {
  if (id === 'backpack') {
    return {
      name: 'Backpack',
      kind: 'ui-only',
      slot: null,
      quality: null,
      group: 'ui-backpack',
    };
  }
  const item = items[id];
  assert(item, `No live item owns public/ui/items/${id}.webp`);
  const slot = typeof item.slot === 'string' ? item.slot : null;
  const quality = typeof item.quality === 'string' ? item.quality : null;
  return {
    name: item.name,
    kind: item.kind,
    slot,
    quality,
    group: item.kind === 'armor' ? `armor-${slot}` : item.kind,
  };
}

function assertExpected(actual, expected, label) {
  if (expected !== undefined) assert.equal(actual, expected, label);
}

export function paginateItemArtAuditRecords(records) {
  const pages = [];
  for (let offset = 0; offset < records.length; offset += IDS_PER_PAGE) {
    pages.push(records.slice(offset, offset + IDS_PER_PAGE));
  }
  return pages;
}

export const ITEM_ART_AUDIT_RENDERER_FINGERPRINT = sha256(
  Buffer.from(readFileSync(fileURLToPath(import.meta.url), 'utf8').replaceAll('\r\n', '\n')),
);

export function evaluateItemArtMachineChecks(records) {
  const invalid = records
    .filter(
      (record) =>
        record.width !== 128 ||
        record.height !== 128 ||
        record.format !== 'webp' ||
        record.colorspace !== 'srgb' ||
        !record.opaque ||
        record.bytes > MAXIMUM_SHIPPING_BYTES,
    )
    .map(({ absolutePath: _absolutePath, ...record }) => record);
  const hashes = new Map();
  for (const record of records) {
    const values = hashes.get(record.sha256) ?? [];
    values.push(record.id);
    hashes.set(record.sha256, values);
  }
  const duplicateHashes = [...hashes.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ sha256: hash, ids }));
  return {
    expectedDimensions: [128, 128],
    expectedFormat: 'webp',
    expectedColorspace: 'srgb',
    requiredOpaque: true,
    maximumBytes: MAXIMUM_SHIPPING_BYTES,
    invalid,
    duplicateHashes,
    passed: invalid.length === 0 && duplicateHashes.length === 0,
  };
}

async function collectSheetEvidence(repoRoot, sheetPaths) {
  const evidence = [];
  for (const sheetPath of sheetPaths) {
    const bytes = await readFile(path.join(repoRoot, sheetPath));
    const metadata = await sharp(bytes).metadata();
    evidence.push({
      path: sheetPath,
      sha256: sha256(bytes),
      bytes: bytes.length,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? 'unknown',
    });
  }
  return evidence;
}

function digestSheetSet(sheetEvidence) {
  const digest = createHash('sha256');
  for (const record of sheetEvidence) {
    digest.update(`${record.path}\0${record.sha256}\0${record.bytes}\n`);
  }
  return digest.digest('hex');
}

function digestShippingCatalog(records) {
  const digest = createHash('sha256');
  for (const record of records) {
    digest.update(`${record.id}\0${record.sha256}\0${record.bytes}\n`);
  }
  return digest.digest('hex');
}

export async function buildItemArtAudit(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const itemDirectory = options.itemDirectory ?? 'public/ui/items';
  const outputDirectory = options.outputDirectory;
  const itemDir = resolveInside(repoRoot, itemDirectory, 'itemDirectory');
  const outputDir = resolveInside(repoRoot, outputDirectory, 'outputDirectory');
  const temporaryRoot = path.join(repoRoot, 'tmp');
  const temporaryRelative = path.relative(temporaryRoot, outputDir);
  assert(
    temporaryRelative.length > 0 &&
      temporaryRelative !== '..' &&
      !temporaryRelative.startsWith(`..${path.sep}`),
    'outputDirectory must resolve inside the repository tmp/ directory',
  );
  const sheetDir = path.join(outputDir, 'sheets');
  const relativeSheetDirectory = posixRelative(repoRoot, sheetDir);
  const fileNames = (await readdir(itemDir)).filter((name) => name.endsWith('.webp')).sort();
  const fileIds = new Set(fileNames.map((name) => name.slice(0, -'.webp'.length)));
  const owners = itemIconOwnershipIndex(options.mapping);
  assert.deepEqual(
    [...owners.keys()].sort(),
    [...fileIds].sort(),
    'mapping.json owners and shipping item-art files must be a bijection',
  );
  for (const id of fileIds) assertExactlyOneItemIconOwner(id, owners);
  const generatedHeroicDefinitions = Object.entries(options.items).filter(
    ([, item]) => typeof item.heroicOf === 'string',
  );
  const heroicWeaponArtAliases = generatedHeroicDefinitions.filter(([id]) => !fileIds.has(id));
  const heroicDefinitionsWithOwnWebp = generatedHeroicDefinitions.filter(([id]) => fileIds.has(id));
  assert(
    heroicWeaponArtAliases.every(([, item]) => item.kind === 'weapon'),
    'Only heroic weapons may intentionally alias base art',
  );
  assert(
    heroicWeaponArtAliases.every(([, item]) => fileIds.has(item.heroicOf)),
    'Every heroic weapon art alias must reference a shipping base-art file',
  );
  const missingFiles = Object.entries(options.items)
    .filter(([id, item]) => !fileIds.has(id) && !(item.kind === 'weapon' && item.heroicOf))
    .map(([id]) => id);
  assert.deepEqual(
    missingFiles,
    [],
    `Live item definitions without dedicated art: ${missingFiles}`,
  );

  const aliasesByBase = new Map();
  for (const [id, item] of heroicWeaponArtAliases) {
    const aliases = aliasesByBase.get(item.heroicOf) ?? [];
    aliases.push(id);
    aliasesByBase.set(item.heroicOf, aliases);
  }

  const catalogWithPaths = [];
  for (const fileName of fileNames) {
    const id = fileName.slice(0, -'.webp'.length);
    const absolutePath = path.join(itemDir, fileName);
    const buffer = await readFile(absolutePath);
    const metadata = await sharp(buffer).metadata();
    const stats = await sharp(buffer).stats();
    const domain = groupFor(id, options.items);
    catalogWithPaths.push({
      id,
      ...domain,
      aliases: (aliasesByBase.get(id) ?? []).sort(),
      absolutePath,
      path: posixRelative(repoRoot, absolutePath),
      sha256: sha256(buffer),
      bytes: buffer.length,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? 'unknown',
      colorspace: metadata.space ?? 'unknown',
      channels: metadata.channels ?? 0,
      hasAlpha: metadata.hasAlpha ?? false,
      opaque: stats.isOpaque,
    });
  }

  const machineChecks = evaluateItemArtMachineChecks(catalogWithPaths);
  const groups = new Map();
  for (const record of catalogWithPaths) {
    const records = groups.get(record.group) ?? [];
    records.push(record);
    groups.set(record.group, records);
  }
  const sortedGroups = [...groups].sort(([left], [right]) => compareText(left, right));
  const sheetPageCount = sortedGroups.reduce(
    (sum, [, records]) => sum + paginateItemArtAuditRecords(records).length,
    0,
  );

  assertExpected(
    catalogWithPaths.length,
    options.expected?.catalogCount,
    'Unexpected item-art catalog count',
  );
  assertExpected(
    Object.keys(options.items).length,
    options.expected?.liveItemCount,
    'Unexpected live item definition count',
  );
  assertExpected(
    generatedHeroicDefinitions.length,
    options.expected?.generatedHeroicDefinitions,
    'Unexpected generated Heroic definition count',
  );
  assertExpected(
    heroicDefinitionsWithOwnWebp.length,
    options.expected?.heroicDefinitionsWithOwnWebp,
    'Unexpected Heroic dedicated-art count',
  );
  assertExpected(
    heroicWeaponArtAliases.length,
    options.expected?.heroicWeaponArtAliases,
    'Unexpected Heroic weapon alias count',
  );
  assertExpected(
    sheetPageCount,
    options.expected?.sheetPageCount,
    'Unexpected item-art sheet page count',
  );
  assertExpected(groups.size, options.expected?.groupCount, 'Unexpected item-art group count');

  const renderOutputs = options.renderOutputs ?? true;
  if (renderOutputs) {
    await mkdir(outputDir, { recursive: true });
    await rm(sheetDir, { recursive: true, force: true });
    await mkdir(sheetDir, { recursive: true });
  }
  const sheetPaths = [];
  for (const [group, records] of sortedGroups) {
    records.sort((left, right) => compareText(left.id, right.id));
    for (const [pageIndex, pageRecords] of paginateItemArtAuditRecords(records).entries()) {
      const page = pageIndex + 1;
      for (const mode of SINGLE_PREVIEW_MODES) {
        sheetPaths.push(
          renderOutputs
            ? await modeSheet(sheetDir, relativeSheetDirectory, group, page, pageRecords, mode)
            : plannedSheetPath(relativeSheetDirectory, group, page, mode),
        );
      }
      sheetPaths.push(
        renderOutputs
          ? await smallMultiviewSheet(sheetDir, relativeSheetDirectory, group, page, pageRecords)
          : plannedSheetPath(relativeSheetDirectory, group, page, 'small-multiview'),
      );
      sheetPaths.push(
        renderOutputs
          ? await identitySheet(sheetDir, relativeSheetDirectory, group, page, pageRecords)
          : plannedSheetPath(relativeSheetDirectory, group, page, 'identity'),
      );
    }
  }

  const records = catalogWithPaths.map(({ absolutePath: _absolutePath, ...record }) => record);
  const catalog = {
    schemaVersion: 1,
    generator: {
      script: 'scripts/item_art_audit.mjs',
      contractVersion: 1,
      rendererFingerprint: ITEM_ART_AUDIT_RENDERER_FINGERPRINT,
    },
    catalogCount: records.length,
    liveItemCount: Object.keys(options.items).length,
    generatedHeroicDefinitions: generatedHeroicDefinitions.length,
    heroicDefinitionsWithOwnWebp: heroicDefinitionsWithOwnWebp.length,
    heroicWeaponArtAliases: records.reduce((sum, record) => sum + record.aliases.length, 0),
    groups: Object.fromEntries(
      sortedGroups.map(([group, groupRecords]) => [group, groupRecords.length]),
    ),
    sheetPageCount,
    sheetModes: [...ITEM_ART_AUDIT_MODES],
    machineChecks,
    sheetPaths,
    records,
  };
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
  const catalogAbsolutePath = path.join(outputDir, 'catalog.json');
  if (renderOutputs) await writeFile(catalogAbsolutePath, catalogBytes);
  const sheetEvidence = renderOutputs ? await collectSheetEvidence(repoRoot, sheetPaths) : [];
  const sheetModeCounts = Object.fromEntries(ITEM_ART_AUDIT_MODES.map((mode) => [mode, 0]));
  for (const sheetPath of sheetPaths) {
    const mode = ITEM_ART_AUDIT_MODES.find((candidate) => sheetPath.endsWith(`--${candidate}.png`));
    assert(mode, `Unrecognized sheet mode: ${sheetPath}`);
    sheetModeCounts[mode] += 1;
  }

  return {
    catalog,
    catalogBytes,
    catalogPath: posixRelative(repoRoot, catalogAbsolutePath),
    catalogSha256: sha256(catalogBytes),
    rendererFingerprint: ITEM_ART_AUDIT_RENDERER_FINGERPRINT,
    sheetEvidence,
    sheetModeCounts,
    sheetSetSha256: renderOutputs ? digestSheetSet(sheetEvidence) : null,
    shippingCatalogSha256: digestShippingCatalog(records),
  };
}

export function assertItemArtAuditPass(build) {
  assert.equal(
    build.catalog.machineChecks.passed,
    true,
    'Item-art machine checks failed; inspect the audit catalog before review',
  );
}

function assertVerdictMatchesCatalog(source, build) {
  const catalog = build.catalog;
  assertItemArtAuditPass(build);
  assert.equal(
    build.sheetEvidence.length,
    catalog.sheetPaths.length,
    'Cannot refresh a visual verdict without every planned contact sheet',
  );
  assert.deepEqual(
    build.sheetEvidence.map(({ path: sheetPath }) => sheetPath),
    catalog.sheetPaths,
    'Rendered contact-sheet evidence no longer matches the planned sheet set',
  );
  assert(build.sheetSetSha256, 'Cannot refresh a visual verdict without a sheet-set digest');
  assert.equal(source.schemaVersion, 1, 'Expected final item-art verdict schemaVersion 1');
  assert.equal(
    source.auditScope.itemArtFilesReviewed,
    catalog.catalogCount,
    'Manual verdict item count no longer matches the catalog',
  );
  assert.equal(
    source.auditScope.liveItemDefinitions,
    catalog.liveItemCount,
    'Manual verdict live definition count no longer matches the catalog',
  );
  assert.equal(
    source.auditScope.generatedHeroicDefinitions,
    catalog.generatedHeroicDefinitions,
    'Manual verdict Heroic definition count no longer matches the catalog',
  );
  assert.equal(
    source.auditScope.heroicDefinitionsWithOwnWebp,
    catalog.heroicDefinitionsWithOwnWebp,
    'Manual verdict Heroic dedicated-art count no longer matches the catalog',
  );
  assert.equal(
    source.auditScope.heroicWeaponArtAliases,
    catalog.heroicWeaponArtAliases,
    'Manual verdict Heroic alias count no longer matches the catalog',
  );
  assert.deepEqual(source.auditScope.groups, catalog.groups, 'Manual verdict groups changed');
  assert.equal(source.visualVerdict.passCount, catalog.catalogCount, 'Manual pass count changed');
  assert.deepEqual(
    source.visualVerdict.passIds,
    catalog.records.map((record) => record.id),
    'Manual pass IDs changed',
  );
  assert.equal(
    source.evidence.shippingCatalogSha256,
    build.shippingCatalogSha256,
    'Shipping art changed after manual visual review; create a new reviewed verdict instead of refreshing this one',
  );
  const recordById = new Map(catalog.records.map((record) => [record.id, record]));
  for (const resolution of source.resolvedDuringAudit) {
    for (const pin of resolution.finalShipping) {
      const record = recordById.get(pin.id);
      assert(record, `Resolved audit item is absent from the current catalog: ${pin.id}`);
      assert.deepEqual(
        pin,
        { id: record.id, path: record.path, sha256: record.sha256, bytes: record.bytes },
        `Resolved audit pin changed for ${pin.id}`,
      );
    }
  }
}

export function updateItemArtAuditVerdict(source, build) {
  assertVerdictMatchesCatalog(source, build);
  return {
    ...source,
    reviewContract: {
      ...source.reviewContract,
      everyShippingFileReviewedInModes: [...ITEM_ART_AUDIT_REVIEW_MODES],
    },
    machineChecks: {
      passed: build.catalog.machineChecks.passed,
      requiredDimensions: build.catalog.machineChecks.expectedDimensions,
      requiredFormat: build.catalog.machineChecks.expectedFormat,
      requiredColorspace: build.catalog.machineChecks.expectedColorspace,
      requiredOpaque: build.catalog.machineChecks.requiredOpaque,
      maximumBytes: build.catalog.machineChecks.maximumBytes,
      invalidIds: build.catalog.machineChecks.invalid.map((record) => record.id),
      duplicateHashGroups: build.catalog.machineChecks.duplicateHashes,
    },
    evidence: {
      catalog: {
        path: build.catalogPath,
        sha256: build.catalogSha256,
        bytes: build.catalogBytes.length,
      },
      rendererFingerprint: build.rendererFingerprint,
      sheetCount: build.sheetEvidence.length,
      sheetModeCounts: build.sheetModeCounts,
      sheetSetSha256: build.sheetSetSha256,
      sheets: build.sheetEvidence,
      shippingCatalogSha256: build.shippingCatalogSha256,
    },
  };
}

export async function writeItemArtAuditVerdict(verdictPath, build) {
  const sourceBytes = await readFile(verdictPath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const verdict = updateItemArtAuditVerdict(source, build);
  const bytes = Buffer.from(`${JSON.stringify(verdict, null, 2)}\n`);
  await writeFile(verdictPath, bytes);
  return { verdict, bytes, sha256: sha256(bytes) };
}
