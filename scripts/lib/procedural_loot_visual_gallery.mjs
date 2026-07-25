export const GALLERY_VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
});

export const RARITIES = Object.freeze(['common', 'magic', 'rare', 'epic', 'legendary']);

const EXPECTED_BASE_COUNT = 34;
const EXPECTED_LEGENDARY_VARIANT_COUNT = 21;

const PROGRESSION_GROUPS = Object.freeze([
  {
    filename: '01-40px-cloth-upper.png',
    title: 'Cloth progression: upper slots',
    subtitle: 'Helmet, shoulder, chest, and waist at the production 40px bag scale.',
    matches: (base) =>
      base.armorType === 'cloth' && ['helmet', 'shoulder', 'chest', 'waist'].includes(base.slot),
  },
  {
    filename: '02-40px-cloth-lower.png',
    title: 'Cloth progression: lower slots',
    subtitle: 'Legs, gloves, and feet at the production 40px bag scale.',
    matches: (base) => base.armorType === 'cloth' && ['legs', 'gloves', 'feet'].includes(base.slot),
  },
  {
    filename: '03-40px-leather-upper.png',
    title: 'Leather progression: upper slots',
    subtitle: 'Helmet, shoulder, chest, and waist at the production 40px bag scale.',
    matches: (base) =>
      base.armorType === 'leather' && ['helmet', 'shoulder', 'chest', 'waist'].includes(base.slot),
  },
  {
    filename: '04-40px-leather-lower.png',
    title: 'Leather progression: lower slots',
    subtitle: 'Legs, gloves, and feet at the production 40px bag scale.',
    matches: (base) =>
      base.armorType === 'leather' && ['legs', 'gloves', 'feet'].includes(base.slot),
  },
  {
    filename: '05-40px-mail-upper.png',
    title: 'Mail progression: upper slots',
    subtitle: 'Helmet, shoulder, chest, and waist at the production 40px bag scale.',
    matches: (base) =>
      base.armorType === 'mail' && ['helmet', 'shoulder', 'chest', 'waist'].includes(base.slot),
  },
  {
    filename: '06-40px-mail-lower.png',
    title: 'Mail progression: lower slots',
    subtitle: 'Legs, gloves, and feet at the production 40px bag scale.',
    matches: (base) => base.armorType === 'mail' && ['legs', 'gloves', 'feet'].includes(base.slot),
  },
  {
    filename: '07-40px-melee-reach-weapons.png',
    title: 'Weapon progression: melee and reach',
    subtitle: 'Sword, dagger, mace, axe, and polearm at the production 40px bag scale.',
    matches: (base) =>
      base.kind === 'weapon' &&
      ['sword', 'dagger', 'mace', 'axe', 'polearm'].includes(base.weaponType),
  },
  {
    filename: '08-40px-caster-ranged-weapons.png',
    title: 'Weapon progression: caster and ranged',
    subtitle: 'Staff, wand, bow, and crossbow at the production 40px bag scale.',
    matches: (base) =>
      base.kind === 'weapon' && ['staff', 'wand', 'bow', 'crossbow'].includes(base.weaponType),
  },
  {
    filename: '09-40px-jewelry-offhands.png',
    title: 'Jewelry and offhand progression',
    subtitle: 'Ring, neck, shield, and caster offhand at the production 40px bag scale.',
    matches: (base) =>
      base.slot === 'ring' ||
      base.slot === 'neck' ||
      base.shield === true ||
      base.kind === 'held_offhand',
  },
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function titleCase(value) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function pageShell(title, subtitle, content, pageClass = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      background: #090a0d;
      color: #f5edd8;
    }
    * {
      box-sizing: border-box;
      animation: none !important;
      transition: none !important;
    }
    html, body {
      width: ${GALLERY_VIEWPORT.width}px;
      height: ${GALLERY_VIEWPORT.height}px;
      margin: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% -20%, rgba(93, 76, 42, 0.24), transparent 48%),
        linear-gradient(180deg, #151319 0%, #090a0d 100%);
    }
    body {
      padding: 26px 32px 24px;
    }
    header {
      height: 82px;
      border-bottom: 1px solid #67542e;
      margin-bottom: 16px;
    }
    h1 {
      color: #e8c76f;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.15;
      margin: 0 0 8px;
    }
    .subtitle {
      color: #bcb39f;
      font-size: 13px;
      line-height: 1.35;
      margin: 0;
    }
    .progression {
      display: grid;
      gap: 10px;
    }
    .progression-header,
    .progression-row {
      display: grid;
      grid-template-columns: 250px repeat(5, minmax(0, 1fr));
      gap: 10px;
      align-items: center;
    }
    .progression-header {
      color: #a99c82;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      padding: 0 10px;
      text-align: center;
      text-transform: uppercase;
    }
    .progression-row {
      min-height: 118px;
      background: rgba(19, 18, 23, 0.92);
      border: 1px solid #37313a;
      border-radius: 5px;
      padding: 10px;
    }
    .family-name {
      color: #f0dfb4;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 17px;
      line-height: 1.15;
      margin-bottom: 7px;
    }
    .family-id,
    .asset-id,
    .power-id {
      color: #8f887b;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 9px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .asset-cell {
      min-width: 0;
      text-align: center;
    }
    .icon-frame {
      align-items: center;
      background: #08090b;
      border: 2px solid #a5a5a5;
      border-radius: 5px;
      display: inline-flex;
      height: 52px;
      justify-content: center;
      margin-bottom: 6px;
      position: relative;
      width: 52px;
    }
    .rarity-magic .icon-frame { border-color: #2887dc; }
    .rarity-rare .icon-frame { border-color: #e0bd42; }
    .rarity-epic .icon-frame { border-color: #9859d8; }
    .rarity-legendary .icon-frame {
      border-color: #e78826;
      box-shadow: 0 0 10px rgba(231, 136, 38, 0.22);
    }
    .icon-frame img {
      display: block;
      height: 40px;
      object-fit: contain;
      width: 40px;
    }
    .cell-rarity {
      color: #d8ceb9;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .contact-layout {
      display: grid;
      gap: 14px;
      grid-template-columns: 1fr 1fr 1.45fr;
    }
    .contact-panel {
      min-width: 0;
    }
    .contact-panel h2 {
      color: #d9bf7b;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .contact-rarity-header,
    .contact-family-row {
      display: grid;
      grid-template-columns: minmax(118px, 1fr) repeat(5, 32px);
      gap: 4px;
      align-items: center;
    }
    .contact-rarity-header {
      color: #9d9584;
      font-size: 7px;
      height: 18px;
      text-align: center;
      text-transform: uppercase;
    }
    .contact-family-row {
      border-top: 1px solid rgba(97, 86, 66, 0.28);
      height: 35px;
    }
    .contact-family-label {
      min-width: 0;
      padding-right: 4px;
    }
    .contact-family-name {
      color: #e5d7b9;
      font-size: 8px;
      line-height: 1.1;
    }
    .contact-family-id {
      color: #777165;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 6px;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .contact-icon {
      align-items: center;
      background: #08090b;
      border: 1px solid #5a554d;
      border-radius: 3px;
      display: flex;
      height: 32px;
      justify-content: center;
      width: 32px;
    }
    .contact-icon img {
      display: block;
      height: 28px;
      object-fit: contain;
      width: 28px;
    }
    .contact-legendary-list {
      display: grid;
      gap: 0;
    }
    .contact-legendary-row {
      align-items: center;
      border-top: 1px solid rgba(97, 86, 66, 0.28);
      display: grid;
      gap: 7px;
      grid-template-columns: 32px minmax(0, 1fr);
      height: 34px;
    }
    .contact-power-name {
      color: #e6b35d;
      font-size: 8px;
      line-height: 1.08;
    }
    .contact-power-meta {
      color: #777165;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 6px;
      line-height: 1.05;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .legendary-list {
      display: grid;
      gap: 7px;
    }
    .legendary-row {
      align-items: center;
      background: rgba(19, 18, 23, 0.92);
      border: 1px solid #3f3327;
      border-radius: 5px;
      display: grid;
      gap: 14px;
      grid-template-columns: 250px 62px minmax(260px, 1fr) 320px;
      min-height: 61px;
      padding: 7px 12px;
    }
    .legendary-family {
      color: #e8dbc0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 14px;
      line-height: 1.1;
    }
    .legendary-icon {
      align-items: center;
      background: #08090b;
      border: 2px solid #e78826;
      border-radius: 5px;
      display: flex;
      height: 52px;
      justify-content: center;
      width: 52px;
    }
    .legendary-icon img {
      display: block;
      height: 40px;
      object-fit: contain;
      width: 40px;
    }
    .power-name {
      color: #edae45;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 15px;
      line-height: 1.1;
      margin-bottom: 5px;
    }
    .page-note {
      bottom: 10px;
      color: #655f55;
      font-family: Consolas, "SFMono-Regular", monospace;
      font-size: 8px;
      left: 32px;
      position: fixed;
    }
  </style>
</head>
<body class="${escapeHtml(pageClass)}">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(subtitle)}</p>
  </header>
  ${content}
  <div class="page-note">Production resolver URLs, lossless PNG, 1440x900, DPR 1</div>
</body>
</html>`;
}

function renderProgressionCell(cell) {
  return `<div class="asset-cell rarity-${escapeHtml(cell.rarity)}">
    <div class="icon-frame">
      <img
        src="${escapeHtml(cell.url)}"
        alt="${escapeHtml(`${cell.rarity} ${cell.baseName}`)}"
        data-asset-id="${escapeHtml(cell.assetId)}"
        data-render-size="40"
        width="40"
        height="40"
      >
    </div>
    <div class="cell-rarity">${escapeHtml(titleCase(cell.rarity))}</div>
    <div class="asset-id">${escapeHtml(cell.assetId)}</div>
  </div>`;
}

function renderProgressionPage(group, bases) {
  const header = `<div class="progression-header">
    <div>Family</div>
    ${RARITIES.map((rarity) => `<div>${escapeHtml(titleCase(rarity))}</div>`).join('')}
  </div>`;
  const rows = bases
    .map(
      (base) => `<div class="progression-row">
        <div>
          <div class="family-name">${escapeHtml(base.name)}</div>
          <div class="family-id">${escapeHtml(base.id)}</div>
        </div>
        ${base.rarityCells.map(renderProgressionCell).join('')}
      </div>`,
    )
    .join('');
  return pageShell(
    group.title,
    group.subtitle,
    `<main class="progression">${header}${rows}</main>`,
  );
}

function renderContactFamilyRow(base) {
  return `<div class="contact-family-row">
    <div class="contact-family-label">
      <div class="contact-family-name">${escapeHtml(base.name)}</div>
      <div class="contact-family-id">${escapeHtml(base.id)}</div>
    </div>
    ${base.rarityCells
      .map(
        (cell) => `<div class="contact-icon rarity-${escapeHtml(cell.rarity)}">
          <img
            src="${escapeHtml(cell.url)}"
            alt="${escapeHtml(`${cell.rarity} ${cell.baseName}`)}"
            data-asset-id="${escapeHtml(cell.assetId)}"
            data-render-size="28"
            width="28"
            height="28"
          >
        </div>`,
      )
      .join('')}
  </div>`;
}

function renderContactPanel(title, bases) {
  return `<section class="contact-panel">
    <h2>${escapeHtml(title)}</h2>
    <div class="contact-rarity-header">
      <div>Family</div>
      ${RARITIES.map((rarity) => `<div>${escapeHtml(rarity.slice(0, 3))}</div>`).join('')}
    </div>
    ${bases.map(renderContactFamilyRow).join('')}
  </section>`;
}

function renderContactLegendaryRow(variant) {
  return `<div class="contact-legendary-row">
    <div class="contact-icon rarity-legendary">
      <img
        src="${escapeHtml(variant.url)}"
        alt="${escapeHtml(`${variant.powerName} on ${variant.baseName}`)}"
        data-asset-id="${escapeHtml(variant.assetId)}"
        data-render-size="28"
        width="28"
        height="28"
      >
    </div>
    <div>
      <div class="contact-power-name">${escapeHtml(variant.powerName)} / ${escapeHtml(
        variant.baseName,
      )}</div>
      <div class="contact-power-meta">${escapeHtml(variant.powerId)} / ${escapeHtml(
        variant.baseId,
      )}</div>
    </div>
  </div>`;
}

function renderContactPage(bases, legendaryVariants) {
  const splitAt = Math.ceil(bases.length / 2);
  const content = `<main class="contact-layout">
    ${renderContactPanel('Families 1 to 17', bases.slice(0, splitAt))}
    ${renderContactPanel('Families 18 to 34', bases.slice(splitAt))}
    <section class="contact-panel">
      <h2>Valid named Legendary variants</h2>
      <div class="contact-legendary-list">
        ${legendaryVariants.map(renderContactLegendaryRow).join('')}
      </div>
    </section>
  </main>`;
  return pageShell(
    'Complete 28px procedural loot contact sheet',
    'Every family rarity fallback and all 21 valid base/power pairings at native compact scale.',
    content,
    'contact-page',
  );
}

function renderLegendaryRow(variant) {
  return `<div class="legendary-row">
    <div>
      <div class="legendary-family">${escapeHtml(variant.baseName)}</div>
      <div class="family-id">${escapeHtml(variant.baseId)}</div>
    </div>
    <div class="legendary-icon">
      <img
        src="${escapeHtml(variant.url)}"
        alt="${escapeHtml(`${variant.powerName} on ${variant.baseName}`)}"
        data-asset-id="${escapeHtml(variant.assetId)}"
        data-render-size="40"
        width="40"
        height="40"
      >
    </div>
    <div>
      <div class="power-name">${escapeHtml(variant.powerName)}</div>
      <div class="power-id">${escapeHtml(variant.powerId)}</div>
    </div>
    <div class="asset-id">${escapeHtml(variant.assetId)}<br>${escapeHtml(variant.url)}</div>
  </div>`;
}

function renderLegendaryPage(variants, pageNumber, totalPages) {
  return pageShell(
    `Named Legendary variants: ${pageNumber} of ${totalPages}`,
    'Each row is a valid production base/power pairing. Shared powers intentionally reuse their power-specific asset URL.',
    `<main class="legendary-list">${variants.map(renderLegendaryRow).join('')}</main>`,
  );
}

export function validateGalleryContract(contract) {
  const errors = [];
  const baseIds = contract.bases.map((base) => base.id);
  const baseIdSet = new Set(baseIds);
  const variantKeys = contract.legendaryVariants.map(
    (variant) => `${variant.baseId}:${variant.powerId}`,
  );

  if (contract.bases.length !== EXPECTED_BASE_COUNT) {
    errors.push(`expected ${EXPECTED_BASE_COUNT} bases, received ${contract.bases.length}`);
  }
  if (baseIdSet.size !== contract.bases.length) {
    errors.push('base ids are not unique');
  }
  if (contract.legendaryVariants.length !== EXPECTED_LEGENDARY_VARIANT_COUNT) {
    errors.push(
      `expected ${EXPECTED_LEGENDARY_VARIANT_COUNT} valid Legendary variants, received ${contract.legendaryVariants.length}`,
    );
  }
  if (new Set(variantKeys).size !== variantKeys.length) {
    errors.push('Legendary base/power pairings are not unique');
  }

  for (const base of contract.bases) {
    if (base.rarityCells.length !== RARITIES.length) {
      errors.push(`${base.id} does not have exactly ${RARITIES.length} rarity cells`);
      continue;
    }
    const rarities = base.rarityCells.map((cell) => cell.rarity);
    if (RARITIES.some((rarity, index) => rarity !== rarities[index])) {
      errors.push(`${base.id} rarity order is ${rarities.join(', ')}`);
    }
    for (const cell of base.rarityCells) {
      if (!cell.assetId || !cell.url) {
        errors.push(`${base.id}:${cell.rarity} did not resolve an asset id and URL`);
      }
    }
  }

  for (const variant of contract.legendaryVariants) {
    if (!baseIdSet.has(variant.baseId)) {
      errors.push(`${variant.powerId} references unknown base ${variant.baseId}`);
    }
    if (!variant.assetId || !variant.url) {
      errors.push(`${variant.baseId}:${variant.powerId} did not resolve an asset id and URL`);
    }
  }

  const groupedIds = [];
  for (const group of PROGRESSION_GROUPS) {
    const matches = contract.bases.filter(group.matches);
    if (matches.length === 0) errors.push(`${group.filename} has no matching families`);
    groupedIds.push(...matches.map((base) => base.id));
  }
  const groupedSet = new Set(groupedIds);
  if (groupedIds.length !== groupedSet.size) {
    errors.push('one or more families appear in multiple progression groups');
  }
  const ungrouped = baseIds.filter((id) => !groupedSet.has(id));
  if (ungrouped.length > 0) errors.push(`ungrouped families: ${ungrouped.join(', ')}`);
  const unknownGrouped = groupedIds.filter((id) => !baseIdSet.has(id));
  if (unknownGrouped.length > 0) {
    errors.push(`progression groups contain unknown families: ${unknownGrouped.join(', ')}`);
  }

  return errors;
}

export function allGalleryAssetCells(contract) {
  return [...contract.bases.flatMap((base) => base.rarityCells), ...contract.legendaryVariants];
}

export function buildGalleryPages(contract) {
  const pages = PROGRESSION_GROUPS.map((group) => {
    const bases = contract.bases.filter(group.matches);
    return {
      filename: group.filename,
      html: renderProgressionPage(group, bases),
      expectedImageCount: bases.length * RARITIES.length,
    };
  });

  pages.push({
    filename: '10-28px-complete-contact-sheet.png',
    html: renderContactPage(contract.bases, contract.legendaryVariants),
    expectedImageCount: contract.bases.length * RARITIES.length + contract.legendaryVariants.length,
  });

  const namedPageSize = Math.ceil(contract.legendaryVariants.length / 2);
  const namedPages = [
    contract.legendaryVariants.slice(0, namedPageSize),
    contract.legendaryVariants.slice(namedPageSize),
  ];
  namedPages.forEach((variants, index) => {
    pages.push({
      filename: `${String(11 + index).padStart(2, '0')}-40px-named-legendary-variants-${
        index + 1
      }.png`,
      html: renderLegendaryPage(variants, index + 1, namedPages.length),
      expectedImageCount: variants.length,
    });
  });

  return pages;
}
