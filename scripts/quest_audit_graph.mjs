import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = process.cwd();
const baselineCommit = '4a0461e7';
const sourceModuleDefs = [
  {
    id: 'zone1',
    label: 'Zone 1',
    path: 'src/sim/content/zone1.ts',
    questsExport: 'ZONE1_QUESTS',
    orderExport: 'ZONE1_QUEST_ORDER',
  },
  {
    id: 'zone2',
    label: 'Zone 2',
    path: 'src/sim/content/zone2.ts',
    questsExport: 'ZONE2_QUESTS',
    orderExport: 'ZONE2_QUEST_ORDER',
  },
  {
    id: 'zone3',
    label: 'Zone 3',
    path: 'src/sim/content/zone3.ts',
    questsExport: 'ZONE3_QUESTS',
    orderExport: 'ZONE3_QUEST_ORDER',
  },
  {
    id: 'temple',
    label: 'Temple',
    path: 'src/sim/content/temple.ts',
    questsExport: 'TEMPLE_QUESTS',
    orderExport: 'TEMPLE_QUEST_ORDER',
  },
];
const outArg = process.argv.indexOf('--out');
const outDir = path.resolve(
  root,
  outArg >= 0 && process.argv[outArg + 1] ? process.argv[outArg + 1] : 'tmp/audits/quests',
);

const entrySource = `
  export { QUESTS, QUEST_ORDER, MOBS, NPCS, ITEMS } from './src/sim/data.ts';
  export { ZONE1_QUESTS, ZONE1_QUEST_ORDER } from './src/sim/content/zone1.ts';
  export { ZONE2_QUESTS, ZONE2_QUEST_ORDER } from './src/sim/content/zone2.ts';
  export { ZONE3_QUESTS, ZONE3_QUEST_ORDER } from './src/sim/content/zone3.ts';
  export { TEMPLE_QUESTS, TEMPLE_QUEST_ORDER } from './src/sim/content/temple.ts';
`;

const build = await esbuild.build({
  stdin: {
    contents: entrySource,
    resolveDir: root,
    sourcefile: 'zone1-audit-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
const content = await import(moduleUrl);
const { ITEMS, MOBS, NPCS, QUESTS, QUEST_ORDER } = content;
const sourceModules = sourceModuleDefs.map((source) => ({
  ...source,
  quests: content[source.questsExport],
  order: content[source.orderExport],
}));
const questSourceById = new Map();
for (const source of sourceModules) {
  for (const id of source.order.filter((questId) => source.quests[questId])) {
    questSourceById.set(id, source);
  }
}
const tabs = [
  { id: 'all', label: 'All Quests' },
  ...sourceModules.map((source) => ({ id: source.id, label: source.label })),
  { id: 'dungeon', label: 'Dungeon' },
  { id: 'attunement', label: 'Attunement' },
  { id: 'raid', label: 'Raid' },
];

const questIds = QUEST_ORDER.filter((id) => QUESTS[id]);
const childrenByQuest = new Map(questIds.map((id) => [id, []]));
const parentByQuest = new Map();
for (const id of questIds) {
  const req = QUESTS[id].requiresQuest;
  if (req && childrenByQuest.has(req)) {
    childrenByQuest.get(req).push(id);
    parentByQuest.set(id, req);
  }
}

const targetToQuests = new Map();
for (const id of questIds) {
  for (const objective of QUESTS[id].objectives) {
    const key =
      objective.targetMobId ??
      objective.itemId ??
      objective.targetObjectItemId ??
      objective.targetNpcId;
    if (!key) continue;
    if (!targetToQuests.has(key)) targetToQuests.set(key, []);
    targetToQuests.get(key).push(id);
  }
}

const depthByQuest = new Map();
function markDepth(id, depth) {
  if ((depthByQuest.get(id) ?? -1) >= depth) return;
  depthByQuest.set(id, depth);
  for (const child of childrenByQuest.get(id) ?? []) markDepth(child, depth + 1);
}
for (const id of questIds) {
  if (!parentByQuest.has(id)) markDepth(id, 0);
}

const questHistories = buildQuestHistories(questIds);

const nodes = questIds.map((id) => {
  const quest = QUESTS[id];
  const source = questSourceById.get(id) ?? sourceModules[0];
  const history = questHistories.get(id) ?? { created: null, edits: [] };
  const objectiveLevels = objectiveMobIds(quest)
    .map((mobId) => MOBS[mobId])
    .filter(Boolean)
    .map((mob) => [mob.minLevel, mob.maxLevel]);
  const objectiveMin =
    objectiveLevels.length > 0 ? Math.min(...objectiveLevels.map(([min]) => min)) : null;
  const objectiveMax =
    objectiveLevels.length > 0 ? Math.max(...objectiveLevels.map(([, max]) => max)) : null;
  const minLevel = quest.minLevel ?? 1;
  const auditNotes = notesForQuest(id, quest, objectiveMin);
  const isRisk = auditNotes.some((note) => /^High risk:/i.test(note));
  const isWarn = !isRisk && auditNotes.some((note) => !/^No obvious/i.test(note));
  const isAdded = history.created ? !history.created.commit.startsWith(baselineCommit) : false;
  const isChanged = history.edits.length > 0;
  const originTag =
    isAdded && isChanged
      ? 'Added + Changed'
      : isAdded
        ? 'Added'
        : isChanged
          ? 'Changed'
          : 'Original';
  return {
    id,
    name: quest.name,
    sourceId: source.id,
    sourceLabel: source.label,
    sourcePath: source.path,
    tabs: tabsForQuest(id, quest, source.id),
    minLevel,
    objectiveMin,
    objectiveMax,
    pacingDelta: objectiveMin === null ? 0 : objectiveMin - minLevel,
    giver: NPCS[quest.giverNpcId]?.name ?? quest.giverNpcId,
    turnIn: NPCS[quest.turnInNpcId]?.name ?? quest.turnInNpcId,
    requires: quest.requiresQuest ?? 'None',
    reward: `${quest.xpReward} XP, ${quest.copperReward} copper`,
    objectives: quest.objectives.map((objective) => objectiveSummary(objective)).join('\n'),
    questText: quest.text.replaceAll('$N', '{playerName}'),
    notes: auditNotes.join('\n'),
    history,
    originTag,
    originClass: isAdded ? 'added' : isChanged ? 'changed' : '',
    riskTag: isRisk ? 'High risk' : isWarn ? 'Warning' : 'OK',
    isAdded,
    isChanged,
    isRisk,
    isWarn,
    lane: laneForQuest(id, quest, source.id),
    laneLabel: laneLabelForQuest(id, quest, source.id),
    depth: depthByQuest.get(id) ?? 0,
  };
});

const edges = [];
for (const id of questIds) {
  const req = QUESTS[id].requiresQuest;
  if (req && QUESTS[req]) edges.push({ from: req, to: id });
}

const layouts = Object.fromEntries(
  tabs.map((tab) => [tab.id, layoutNodes(nodes.filter((node) => node.tabs.includes(tab.id)))]),
);

const graphData = {
  sourcePaths: Object.fromEntries(sourceModules.map((source) => [source.id, source.path])),
  tabs,
  nodes,
  edges,
  layouts,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'quest-audit-interactive-graph.html'),
  renderPage({
    title: 'World Of ClaudeCraft Quest Graph',
    subtitle:
      'All-game quest audit. Use tabs to inspect each zone, dungeon, attunement, and raid quest flow.',
    rightPanel: baseDetail(),
    data: graphData,
  }),
);
writeFileSync(
  path.join(outDir, 'quest-audit-overview-graph.html'),
  renderPage({
    title: 'World Of ClaudeCraft Quest Overview',
    subtitle: 'Overview-first all-game quest audit with tabs and source-history details.',
    rightPanel: overviewDetail(nodes),
    data: graphData,
  }),
);

console.log(`Wrote ${path.join(outDir, 'quest-audit-interactive-graph.html')}`);
console.log(`Wrote ${path.join(outDir, 'quest-audit-overview-graph.html')}`);

function objectiveMobIds(quest) {
  const ids = [];
  for (const objective of quest.objectives) {
    if (objective.targetMobId) ids.push(objective.targetMobId);
    if (objective.itemId) {
      for (const [mobId, mob] of Object.entries(MOBS)) {
        if ((mob.loot ?? []).some((loot) => loot.itemId === objective.itemId)) ids.push(mobId);
      }
    }
  }
  return [...new Set(ids)];
}

function objectiveSummary(objective) {
  const target = objective.targetMobId
    ? mobLabel(objective.targetMobId)
    : objective.itemId
      ? itemLabel(objective.itemId)
      : (objective.targetObjectItemId ?? objective.targetNpcId ?? 'Unknown target');
  return `${objective.count} x ${objective.label}\n${target}`;
}

function itemLabel(itemId) {
  const item = ITEMS[itemId];
  const sources = Object.entries(MOBS)
    .filter(([, mob]) => (mob.loot ?? []).some((loot) => loot.itemId === itemId))
    .map(([mobId]) => mobLabel(mobId));
  return sources.length > 0
    ? `${item?.name ?? itemId}\n${sources.join('; ')}`
    : (item?.name ?? itemId);
}

function mobLabel(mobId) {
  const mob = MOBS[mobId];
  return mob ? `${mob.name}, level ${mob.minLevel}-${mob.maxLevel}` : mobId;
}

function notesForQuest(id, quest, objectiveMin) {
  const notes = [];
  const minLevel = quest.minLevel ?? 1;
  if (objectiveMin !== null && objectiveMin - minLevel >= 2) {
    notes.push(`Level pacing: available at ${minLevel}, objective starts at ${objectiveMin}.`);
  }
  for (const objective of quest.objectives) {
    const key =
      objective.targetMobId ??
      objective.itemId ??
      objective.targetObjectItemId ??
      objective.targetNpcId;
    const sharing = key ? (targetToQuests.get(key) ?? []).filter((qid) => qid !== id) : [];
    if (sharing.length > 0) notes.push(`Shared objective target with ${sharing.join(', ')}.`);
  }
  if (id === 'q_ledger_outlaw_captain') {
    notes.push(
      'High risk: asks for bandits, then Captain Verlan, but Captain Verlan is an undead chapel elite rather than a bandit captain.',
    );
  }
  if (id === 'q_ledger_silk') {
    notes.push(
      'Naming risk: title says Browse and Bramble, objective is Spotted Fawns. Coherent, but easy to misread beside spider quests.',
    );
  }
  if (id === 'q_brightwood_thinning') {
    notes.push(
      'Objective mix: kill Bramble Lynx but collect Glade Pelts from several Brightwood beasts. Text should imply general wildlife sampling.',
    );
  }
  if (notes.length === 0) notes.push('No obvious coherence issue found.');
  return notes;
}

function tabsForQuest(id, quest, sourceId) {
  const ids = ['all', sourceId];
  if ((quest.suggestedPlayers ?? 1) >= 5) ids.push('dungeon');
  if (id.startsWith('q_nythraxis_') && id !== 'q_nythraxis_scourges_end') ids.push('attunement');
  if ((quest.suggestedPlayers ?? 1) >= 10 || id === 'q_nythraxis_scourges_end') ids.push('raid');
  return [...new Set(ids)];
}

function laneForQuest(id, quest, sourceId) {
  if (sourceId === 'zone1' && id.startsWith('q_ledger')) return 'zone1-ledger';
  if (sourceId === 'zone1' && id.startsWith('q_brightwood')) return 'zone1-brightwood';
  if (sourceId === 'zone1') return 'zone1-main';
  if (sourceId === 'zone2' && (quest.suggestedPlayers ?? 1) >= 5) return 'zone2-dungeon';
  if (sourceId === 'zone2') return 'zone2-main';
  if (sourceId === 'zone3' && id.startsWith('q_nythraxis_')) return 'zone3-nythraxis';
  if (sourceId === 'zone3' && (quest.suggestedPlayers ?? 1) >= 5) return 'zone3-dungeon';
  if (sourceId === 'zone3') return 'zone3-main';
  if (sourceId === 'temple') return 'temple';
  return sourceId;
}

function laneLabelForQuest(id, quest, sourceId) {
  return (
    {
      'zone1-main': 'Zone 1 Main Chain',
      'zone1-ledger': 'Zone 1 Warden Ledger Chain',
      'zone1-brightwood': 'Zone 1 Brightwood Side Chain',
      'zone2-main': 'Zone 2 Mirefen Chain',
      'zone2-dungeon': 'Zone 2 Sunken Bastion Dungeon',
      'zone3-main': 'Zone 3 Thornpeak Chain',
      'zone3-dungeon': 'Zone 3 Gravewyrm Sanctum Dungeon',
      'zone3-nythraxis': 'Zone 3 Nythraxis Attunement And Raid',
      temple: 'Temple Of The Drowned Moon',
    }[laneForQuest(id, quest, sourceId)] ?? sourceId
  );
}

function layoutNodes(nodeList) {
  if (nodeList.length === 0) return { width: 1500, height: 850, lanes: [] };
  const laneOrder = [...new Set(nodeList.map((node) => node.lane))];
  const visibleIds = new Set(nodeList.map((node) => node.id));
  const localDepths = new Map();
  function markLocalDepth(id, depth) {
    if (!visibleIds.has(id)) return;
    if ((localDepths.get(id) ?? -1) >= depth) return;
    localDepths.set(id, depth);
    for (const child of childrenByQuest.get(id) ?? []) markLocalDepth(child, depth + 1);
  }
  for (const node of nodeList) {
    const parent = parentByQuest.get(node.id);
    if (!parent || !visibleIds.has(parent)) markLocalDepth(node.id, 0);
  }
  const positions = {};
  const laneLayouts = [];
  let y = 130;
  for (const lane of laneOrder) {
    const laneNodes = nodeList.filter((node) => node.lane === lane);
    if (laneNodes.length === 0) continue;
    const groups = new Map();
    for (const node of laneNodes) {
      const localDepth = localDepths.get(node.id) ?? 0;
      if (!groups.has(localDepth)) groups.set(localDepth, []);
      groups.get(localDepth).push(node);
    }
    let maxRows = 1;
    for (const group of groups.values()) maxRows = Math.max(maxRows, group.length);
    for (const [depth, group] of groups) {
      group.sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
      group.forEach((node, index) => {
        positions[node.id] = {
          x: 170 + depth * 235,
          y: y + index * 94,
        };
      });
    }
    laneLayouts.push({ id: lane, label: laneNodes[0]?.laneLabel ?? lane, y: y - 48 });
    y += Math.max(120, maxRows * 94) + 135;
  }
  const placed = Object.values(positions);
  return {
    positions,
    lanes: laneLayouts,
    width: Math.max(1500, Math.max(...placed.map((pos) => pos.x)) + 280),
    height: Math.max(850, Math.max(...placed.map((pos) => pos.y)) + 140),
  };
}

function baseDetail() {
  return '<h2>Select a quest</h2><p class="hint">Click a quest node to inspect objectives, levels, dependencies, change status, and audit notes. Every quest is tagged as Original, Added, or Changed, plus OK, Warning, or High risk.</p>';
}

function buildQuestHistories(ids) {
  const histories = new Map(ids.map((id) => [id, { created: null, edits: [] }]));
  for (const source of sourceModules) {
    const sourceIds = ids.filter((id) => questSourceById.get(id)?.id === source.id);
    buildQuestHistoriesForPath(sourceIds, source.path, histories);
  }
  return histories;
}

function buildQuestHistoriesForPath(ids, sourcePath, histories) {
  const previous = new Map();
  const commitLines = git([
    'log',
    '--follow',
    '--format=%H%x09%ad%x09%s',
    '--date=short',
    '--',
    sourcePath,
  ])
    .split('\n')
    .filter(Boolean)
    .reverse();

  for (const line of commitLines) {
    const [hash, date, ...subjectParts] = line.split('\t');
    const subject = subjectParts.join('\t');
    let source = '';
    try {
      source = git(['show', `${hash}:${sourcePath}`]);
    } catch {
      continue;
    }

    for (const id of ids) {
      const block = extractQuestBlock(source, id);
      if (!block) continue;
      const snapshot = questBlockSnapshot(block);
      const prior = previous.get(id);
      const history = histories.get(id);
      if (!history.created) {
        history.created = { date, commit: hash.slice(0, 8), subject, sourcePath };
        previous.set(id, snapshot);
        continue;
      }
      if (JSON.stringify(snapshot) === JSON.stringify(prior)) continue;
      history.edits.push({
        date,
        commit: hash.slice(0, 8),
        subject,
        changes: summarizeQuestEdit(prior, snapshot),
      });
      previous.set(id, snapshot);
    }
  }
}

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trimEnd();
}

function extractQuestBlock(source, questId) {
  const match = new RegExp(`\\n\\s*${escapeRegExp(questId)}:\\s*\\{`).exec(source);
  if (!match) return null;
  const start = source.indexOf('{', match.index);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function questBlockSnapshot(block) {
  return {
    name: fieldValue(block, 'name'),
    giver: fieldValue(block, 'giverNpcId'),
    turnIn: fieldValue(block, 'turnInNpcId'),
    text: fieldValue(block, 'text'),
    completionText: fieldValue(block, 'completionText'),
    requiresQuest: fieldValue(block, 'requiresQuest') || 'None',
    minLevel: numericFieldValue(block, 'minLevel') ?? 1,
    suggestedPlayers: numericFieldValue(block, 'suggestedPlayers') ?? 1,
    xpReward: numericFieldValue(block, 'xpReward') ?? 0,
    copperReward: numericFieldValue(block, 'copperReward') ?? 0,
    objectives: objectiveBlock(block),
  };
}

function fieldValue(block, field) {
  const match = new RegExp(`${field}:\\s*(['"\`])([\\s\\S]*?)\\1`).exec(block);
  return match ? match[2].replaceAll('$N', '{playerName}') : '';
}

function numericFieldValue(block, field) {
  const match = new RegExp(`${field}:\\s*(\\d+)`).exec(block);
  return match ? Number(match[1]) : null;
}

function objectiveBlock(block) {
  const match = /objectives:\s*\[([\s\S]*?)\]\s*,/.exec(block);
  if (!match) return '';
  const objectiveSource = match[1];
  const objectiveSummaries = [...objectiveSource.matchAll(/\{[^{}]*\}/g)].map((objective) => {
    const source = objective[0];
    const count = numericFieldValue(source, 'count') ?? '?';
    const label = fieldValue(source, 'label') || 'Unlabelled objective';
    const target =
      fieldValue(source, 'targetMobId') ||
      fieldValue(source, 'itemId') ||
      fieldValue(source, 'targetObjectItemId') ||
      fieldValue(source, 'targetNpcId') ||
      'unknown_target';
    return `${count} x ${label} (${target})`;
  });
  if (objectiveSummaries.length > 0) return objectiveSummaries.join('; ');
  return objectiveSource
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}[\]:,])\s*/g, '$1')
    .trim();
}

function summarizeQuestEdit(before, after) {
  const changes = [];
  if (before.name !== after.name) changes.push(changeLine('Name', before.name, after.name));
  if (before.giver !== after.giver) changes.push(changeLine('Giver', before.giver, after.giver));
  if (before.turnIn !== after.turnIn)
    changes.push(changeLine('Turn-in', before.turnIn, after.turnIn));
  if (before.requiresQuest !== after.requiresQuest) {
    changes.push(changeLine('Requires', before.requiresQuest, after.requiresQuest));
  }
  if (before.minLevel !== after.minLevel)
    changes.push(changeLine('Min level', before.minLevel, after.minLevel));
  if (before.suggestedPlayers !== after.suggestedPlayers) {
    changes.push(changeLine('Suggested players', before.suggestedPlayers, after.suggestedPlayers));
  }
  if (before.xpReward !== after.xpReward)
    changes.push(changeLine('XP reward', before.xpReward, after.xpReward));
  if (before.copperReward !== after.copperReward) {
    changes.push(changeLine('Copper reward', before.copperReward, after.copperReward));
  }
  if (before.objectives !== after.objectives)
    changes.push(changeLine('Objectives', before.objectives, after.objectives));
  if (before.text !== after.text) changes.push(changeLine('Offer text', before.text, after.text));
  if (before.completionText !== after.completionText) {
    changes.push(changeLine('Completion text', before.completionText, after.completionText));
  }
  return changes.length > 0 ? changes : ['Quest block changed.'];
}

function changeLine(label, before, after) {
  return `${label}: ${before || 'None'} -> ${after || 'None'}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function overviewDetail(nodeList) {
  const risk = nodeList.filter((node) => node.isRisk);
  const warnings = nodeList.filter((node) => node.isWarn && !node.isRisk);
  const added = nodeList.filter((node) => node.isAdded);
  const changed = nodeList.filter((node) => node.isChanged);
  const pacing = nodeList
    .filter((node) => node.pacingDelta >= 2)
    .sort((a, b) => b.pacingDelta - a.pacingDelta);
  const dupes = nodeList.filter((node) => /Shared objective target/i.test(node.notes));
  return `
    <h2>Quest Overview</h2>
    <p class="hint">Planning summary for all authored quests. Use the top tabs to focus by zone or quest type.</p>
    <div class="metric-grid">
      <div class="metric"><b>${nodeList.length}</b>total quests</div>
      <div class="metric"><b>${added.length}</b>added</div>
      <div class="metric"><b>${changed.length}</b>changed</div>
      <div class="metric"><b>${risk.length}</b>high risk</div>
    </div>
    <div class="section-title">Priority Fixes</div>${listHtml(risk, (node) => `<li><b>${escapeHtml(node.name)}</b>: ${escapeHtml(node.notes)}</li>`)}
    <div class="section-title">Watch List</div>${listHtml(warnings.slice(0, 10), (node) => `<li><b>${escapeHtml(node.name)}</b>: ${escapeHtml(node.notes)}</li>`)}
    <div class="section-title">Pacing Spikes</div>${listHtml(pacing, (node) => `<li><b>${escapeHtml(node.name)}</b>: quest min ${node.minLevel}, objective starts ${node.objectiveMin}, delta +${node.pacingDelta}.</li>`)}
    <div class="section-title">Objective Reuse</div>${listHtml(dupes, (node) => `<li><b>${escapeHtml(node.name)}</b>: ${escapeHtml(node.notes)}</li>`)}
    <div class="section-title">Quest Groups</div>
    <ul>${tabs
      .map((tab) => {
        const quests = nodeList.filter((node) => node.tabs.includes(tab.id));
        if (quests.length === 0) return `<li><b>${escapeHtml(tab.label)}</b>: 0 quests.</li>`;
        return `<li><b>${escapeHtml(tab.label)}</b>: ${quests.length} quests, levels ${Math.min(...quests.map((quest) => quest.minLevel))} to ${Math.max(...quests.map((quest) => quest.minLevel))}.</li>`;
      })
      .join('')}</ul>
  `;
}

function listHtml(items, render) {
  return items.length > 0
    ? `<ul>${items.map(render).join('')}</ul>`
    : '<p class="hint">None detected.</p>';
}

function renderPage({ title, subtitle, rightPanel, data }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${styles()}</style>
</head>
<body>
  <div class="app">
    <header class="top">
      <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
      <div class="stats" id="stats"></div>
    </header>
    <aside class="side">
      <div class="section-title">Filters</div>
      <div class="legend">
        <span class="chip"><span class="dot" style="background:var(--base)"></span>Original</span>
        <span class="chip"><span class="dot" style="background:var(--added)"></span>Added</span>
        <span class="chip"><span class="dot" style="background:var(--changed)"></span>Changed</span>
        <span class="chip"><span class="dot" style="background:var(--risk)"></span>High risk</span>
      </div>
      <div class="section-title">Quest Index</div>
      <div class="list" id="questList"></div>
    </aside>
    <main class="graph-wrap">
      <div class="toolbar">
        <div class="tabs" id="tabs"></div>
        <input id="search" placeholder="Search quest, npc, objective, note">
        <select id="lane">
          <option value="all">All chains</option>
          <option value="main">Main chain</option>
          <option value="ledger">Warden ledger</option>
          <option value="brightwood">Brightwood</option>
        </select>
        <button data-filter="all" class="active">All</button>
        <button data-filter="changed">Changed</button>
        <button data-filter="risk">Risk</button>
        <button data-filter="pacing">Pacing</button>
        <button id="reset">Reset</button>
      </div>
      <svg class="graph" id="graph" role="img" aria-label="Zone 1 quest graph"></svg>
    </main>
    <aside class="detail" id="detail">${rightPanel}</aside>
  </div>
  <script>const DATA=${JSON.stringify(data)};${clientScript()}</script>
</body>
</html>`;
}

function styles() {
  return `:root{--bg:#f6f8fb;--panel:#fff;--ink:#142033;--muted:#5a6678;--grid:#e4ebf3;--base:#eef1f5;--added:#dbeafe;--changed:#fff2cc;--warn:#ffe8b8;--risk:#ffd8d4;--blue:#2563eb;--gold:#b7791f;--red:#c0392b;--ok:#11845b}*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:var(--bg);color:var(--ink);font-size:14px}.app{height:100vh;display:grid;grid-template-columns:300px minmax(720px,1fr) 390px;grid-template-rows:auto 1fr}.top{grid-column:1/4;background:#101827;color:white;padding:16px 20px;display:flex;justify-content:space-between;gap:16px}.top h1{margin:0;font-size:20px}.top p{margin:4px 0 0;color:#cbd5e1}.stats{display:flex;gap:10px}.stat{background:#1f2a3d;border:1px solid #334155;border-radius:6px;padding:8px 10px;min-width:86px}.stat b{display:block;font-size:18px}.side,.detail{background:white;overflow:auto;border-color:#d6dde7}.side{padding:14px;border-right:1px solid #d6dde7}.detail{padding:16px;border-left:1px solid #d6dde7}.graph-wrap{position:relative;overflow:auto}.toolbar{position:sticky;top:0;z-index:10;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px;background:rgba(255,255,255,.94);backdrop-filter:blur(6px);border-bottom:1px solid #d6dde7}.tabs{display:flex;gap:6px;flex-wrap:wrap;flex-basis:100%}.tab{height:34px;border:1px solid #c8d2df;background:white;border-radius:6px;padding:0 10px;color:var(--ink);cursor:pointer}.tab.active{background:#101827;color:white}.toolbar input,.toolbar select,.toolbar button{height:36px;border:1px solid #c8d2df;background:white;border-radius:6px;padding:0 10px;color:var(--ink)}.toolbar input{min-width:260px}.toolbar button{cursor:pointer}.toolbar button.active{background:#101827;color:white}.graph{display:block;min-width:1200px;background:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:28px 28px}.section-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#526174;margin:16px 0 8px;font-weight:800}.legend{display:grid;grid-template-columns:1fr 1fr;gap:8px}.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #d6dde7;border-radius:999px;padding:4px 8px;font-size:12px;background:white}.dot{width:10px;height:10px;border-radius:50%}.list{display:grid;gap:7px}.item{border:1px solid #d6dde7;border-left:5px solid #8a97a8;border-radius:6px;background:white;padding:9px;cursor:pointer;line-height:1.25}.item.active{outline:2px solid var(--blue)}.item b{display:block;font-size:13px}.item small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.lane-line{stroke:#cfd8e3;stroke-width:1}.lane-label{font-size:14px;font-weight:800;fill:#334155;text-transform:uppercase}.edge{stroke:#9aa8b8;stroke-width:2;fill:none;marker-end:url(#arrow)}.edge.dim{opacity:.28}.edge.hot{stroke:#2563eb;stroke-width:3}.node{cursor:pointer}.node rect{rx:8;stroke-width:1.5;filter:drop-shadow(0 3px 5px rgba(20,32,51,.14))}.node.dim{opacity:.42}.node.hot rect{stroke:#2563eb;stroke-width:3}.node text{fill:#142033;pointer-events:none}.node .name{font-size:12.5px;font-weight:800}.node .meta{font-size:10.5px;font-weight:700;fill:#42526a}.detail h2{margin:0 0 8px}.pill-row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 14px}.pill{border-radius:999px;padding:4px 8px;font-size:12px;border:1px solid #c8d2df;background:#f8fafc}.risk{background:var(--risk);border-color:#e08b83}.warn{background:var(--warn);border-color:#e2b65d}.added{background:var(--added);border-color:#8ab7f0}.changed{background:var(--changed);border-color:#e2bd55}.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.metric{border:1px solid #d6dde7;border-radius:6px;padding:10px;background:#fbfcfe}.metric b{display:block;font-size:18px}.kv{display:grid;grid-template-columns:110px 1fr;gap:8px;border-top:1px solid #e2e8f0;padding:8px 0}.kv b{color:#526174}.detail pre{white-space:pre-wrap;font-family:inherit;line-height:1.35;background:#f8fafc;border:1px solid #d6dde7;border-radius:6px;padding:10px}.hint{color:#64748b;line-height:1.45}.bar{height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden}.bar span{display:block;height:100%;background:linear-gradient(90deg,var(--ok),var(--gold),var(--red))}@media(max-width:1100px){.app{grid-template-columns:1fr;grid-template-rows:auto auto 70vh auto}.top{grid-column:1}.side,.detail{border:0}}`;
}

function clientScript() {
  return `
const state={selected:null,filter:'all',query:'',lane:'all',tab:'all'};
const byId=new Map(DATA.nodes.map((node)=>[node.id,node]));
const child=new Map(DATA.nodes.map((node)=>[node.id,[]]));
const parent=new Map(DATA.nodes.map((node)=>[node.id,[]]));
DATA.edges.forEach((edge)=>{child.get(edge.from).push(edge.to);parent.get(edge.to).push(edge.from);});
const esc=(value)=>String(value??'').replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function layout(){return DATA.layouts[state.tab]||DATA.layouts.all;}
function pos(node){return layout().positions[node.id]||DATA.layouts.all.positions[node.id]||{x:170,y:130};}
function tabNodes(){return DATA.nodes.filter((node)=>node.tabs.includes(state.tab));}
function color(node){return node.isRisk?'var(--risk)':node.isWarn?'var(--warn)':node.isAdded?'var(--added)':node.isChanged?'var(--changed)':'var(--base)';}
function stroke(node){return node.isRisk?'var(--red)':node.isWarn?'var(--gold)':node.isAdded?'var(--blue)':node.isChanged?'var(--gold)':'#6b7280';}
function connected(id){const set=new Set([id]);(child.get(id)||[]).forEach((childId)=>set.add(childId));(parent.get(id)||[]).forEach((parentId)=>set.add(parentId));return set;}
function matches(node){if(!node.tabs.includes(state.tab))return false;const q=state.query.toLowerCase();if(state.lane!=='all'&&node.lane!==state.lane)return false;if(state.filter==='changed'&&!node.isChanged&&!node.isAdded)return false;if(state.filter==='risk'&&!node.isRisk&&!node.isWarn)return false;if(state.filter==='pacing'&&node.pacingDelta<2)return false;if(!q)return true;return [node.name,node.id,node.sourceLabel,node.giver,node.turnIn,node.objectives,node.notes,node.history?.created?.subject,...(node.history?.edits??[]).flatMap((edit)=>[edit.subject,...edit.changes])].join(' ').toLowerCase().includes(q);}
function drawTabs(){const tabs=document.getElementById('tabs');tabs.innerHTML='';DATA.tabs.forEach((tab)=>{const count=DATA.nodes.filter((node)=>node.tabs.includes(tab.id)).length;const button=document.createElement('button');button.className='tab '+(state.tab===tab.id?'active':'');button.textContent=tab.label+' ('+count+')';button.onclick=()=>{state.tab=tab.id;state.selected=null;state.lane='all';document.getElementById('lane').value='all';draw();renderList();renderStats();renderLaneOptions();drawTabs();document.querySelector('.graph-wrap').scrollTo({left:0,top:0,behavior:'smooth'});};tabs.appendChild(button);});}
function renderLaneOptions(){const select=document.getElementById('lane');const current=state.lane;select.innerHTML='<option value="all">All chains</option>';layout().lanes.forEach((lane)=>{const option=document.createElement('option');option.value=lane.id;option.textContent=lane.label;select.appendChild(option);});state.lane=[...select.options].some((option)=>option.value===current)?current:'all';select.value=state.lane;}
function draw(){const svg=document.getElementById('graph');const activeLayout=layout();svg.setAttribute('viewBox','0 0 '+activeLayout.width+' '+activeLayout.height);svg.style.width=activeLayout.width+'px';svg.style.height=activeLayout.height+'px';svg.innerHTML='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa8b8"/></marker></defs>';activeLayout.lanes.forEach((lane)=>{svg.insertAdjacentHTML('beforeend','<line class="lane-line" x1="95" y1="'+lane.y+'" x2="'+(activeLayout.width-80)+'" y2="'+lane.y+'"/><text class="lane-label" x="95" y="'+(lane.y-18)+'">'+esc(lane.label)+'</text>');});const hot=state.selected?connected(state.selected):null;DATA.edges.forEach((edge)=>{const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b||!a.tabs.includes(state.tab)||!b.tabs.includes(state.tab))return;const ap=pos(a),bp=pos(b);const dim=(hot&&!hot.has(edge.from)&&!hot.has(edge.to))||!matches(a)||!matches(b);const active=hot&&hot.has(edge.from)&&hot.has(edge.to);svg.insertAdjacentHTML('beforeend','<path class="edge '+(dim?'dim ':'')+(active?'hot':'')+'" d="M '+(ap.x+178)+' '+ap.y+' C '+(ap.x+225)+' '+ap.y+', '+(bp.x-45)+' '+bp.y+', '+bp.x+' '+bp.y+'"/>');});DATA.nodes.filter((node)=>node.tabs.includes(state.tab)).forEach((node)=>{const p=pos(node);const dim=(hot&&!hot.has(node.id))||!matches(node);const active=state.selected===node.id;const label=node.name.length>23?node.name.slice(0,21)+'...':node.name;const levels=node.objectiveMin?'min '+node.minLevel+' | obj '+node.objectiveMin+'-'+node.objectiveMax:'min '+node.minLevel;const tags=node.originTag+' | '+node.riskTag;svg.insertAdjacentHTML('beforeend','<g class="node '+(dim?'dim ':'')+(active?'hot':'')+'" data-id="'+node.id+'" transform="translate('+p.x+','+(p.y-40)+')"><rect width="178" height="80" fill="'+color(node)+'" stroke="'+stroke(node)+'"></rect><text class="name" x="12" y="24">'+esc(label)+'</text><text class="meta" x="12" y="47">'+esc(levels)+'</text><text class="meta" x="12" y="65">'+esc(tags)+'</text></g>');});svg.querySelectorAll('.node').forEach((el)=>el.addEventListener('click',()=>select(el.dataset.id)));}
function renderStats(){const nodes=tabNodes();document.getElementById('stats').innerHTML='<div class="stat"><b>'+nodes.length+'</b>quests</div><div class="stat"><b>'+nodes.filter((node)=>node.isAdded).length+'</b>added</div><div class="stat"><b>'+nodes.filter((node)=>node.isChanged).length+'</b>changed</div><div class="stat"><b>'+nodes.filter((node)=>node.isRisk||node.isWarn).length+'</b>flags</div>';}
function renderList(){const list=document.getElementById('questList');list.innerHTML='';DATA.nodes.filter(matches).sort((a,b)=>a.minLevel-b.minLevel||a.name.localeCompare(b.name)).forEach((node)=>{const row=document.createElement('div');row.className='item '+(state.selected===node.id?'active':'');row.style.borderLeftColor=stroke(node);row.innerHTML='<b>'+esc(node.name)+'</b><small>'+esc(node.id)+' | '+esc(node.sourceLabel+' | '+node.originTag+' | '+node.riskTag)+'</small>';row.onclick=()=>select(node.id);list.appendChild(row);});}
function select(id){state.selected=id;const node=byId.get(id);const next=(child.get(id)||[]).map((childId)=>byId.get(childId).name).join(', ')||'None';const prev=(parent.get(id)||[]).map((parentId)=>byId.get(parentId).name).join(', ')||'None';const pct=Math.min(100,Math.max(0,(node.pacingDelta+1)*20));let html='<h2>'+esc(node.name)+'</h2><div class="pill-row"><span class="pill">'+esc(node.id)+'</span><span class="pill">'+esc(node.sourceLabel)+'</span><span class="pill '+(node.originClass||'')+'">'+esc(node.originTag)+'</span><span class="pill '+(node.riskTag==='High risk'?'risk':node.riskTag==='Warning'?'warn':'')+'">'+esc(node.riskTag)+'</span></div>';html+='<div class="metric-grid"><div class="metric"><b>'+node.minLevel+'</b>quest level</div><div class="metric"><b>'+(node.objectiveMin??'N/A')+(node.objectiveMax&&node.objectiveMax!==node.objectiveMin?'-'+node.objectiveMax:'')+'</b>objective level</div></div>';html+='<div class="section-title">Pacing pressure</div><div class="bar"><span style="width:'+pct+'%"></span></div><p class="hint">Objective min level minus quest min level: '+node.pacingDelta+'</p>';html+='<div class="kv"><b>Giver</b><span>'+esc(node.giver)+'</span></div><div class="kv"><b>Turn-in</b><span>'+esc(node.turnIn)+'</span></div><div class="kv"><b>Requires</b><span>'+esc(node.requires&&node.requires!=='None'?node.requires:prev)+'</span></div><div class="kv"><b>Unlocks</b><span>'+esc(next)+'</span></div><div class="kv"><b>Reward</b><span>'+esc(node.reward)+'</span></div><div class="kv"><b>Source</b><span>'+esc(node.sourcePath)+'</span></div><div class="section-title">Objectives</div><pre>'+esc(node.objectives)+'</pre><div class="section-title">Audit Notes</div><pre>'+esc(node.notes)+'</pre><div class="section-title">Quest Text</div><pre>'+esc(node.questText)+'</pre>';const created=node.history?.created;html+='<div class="section-title">Creation And Edit History</div>';if(created){html+='<div class="kv"><b>Created</b><span>'+esc(created.date+' | '+created.commit+' | '+created.subject)+'</span></div>';}else{html+='<p class="hint">No creation commit found for this quest in '+esc(node.sourcePath)+'.</p>';}const edits=node.history?.edits??[];if(edits.length>0){html+='<pre>'+esc(edits.map((edit)=>edit.date+' | '+edit.commit+' | '+edit.subject+'\\n- '+edit.changes.join('\\n- ')).join('\\n\\n'))+'</pre>';}else{html+='<p class="hint">No later quest-block edits detected.</p>';}document.getElementById('detail').innerHTML=html;draw();renderList();}
function resetAll(){state.selected=null;state.query='';state.filter='all';state.lane='all';document.getElementById('search').value='';document.getElementById('lane').value='all';document.querySelectorAll('[data-filter]').forEach((button)=>button.classList.toggle('active',button.dataset.filter==='all'));draw();renderList();document.querySelector('.graph-wrap').scrollTo({left:0,top:0,behavior:'smooth'});}
document.getElementById('search').oninput=(event)=>{state.query=event.target.value;draw();renderList();};
document.getElementById('lane').onchange=(event)=>{state.lane=event.target.value;draw();renderList();};
document.querySelectorAll('[data-filter]').forEach((button)=>button.onclick=()=>{document.querySelectorAll('[data-filter]').forEach((item)=>item.classList.remove('active'));button.classList.add('active');state.filter=button.dataset.filter;draw();renderList();});
document.getElementById('reset').onclick=resetAll;
drawTabs();renderLaneOptions();renderStats();draw();renderList();`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
}
