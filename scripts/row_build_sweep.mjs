import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as esbuild from 'esbuild';

const root = process.cwd();
const outDir = path.join(root, 'docs', 'balance');
const jsonPath = path.join(outDir, 'row-sweep.json');
const mdPath = path.join(outDir, 'row-sweep.md');
const fullSeconds = 30;
const fallbackSeconds = 15;
const ticksPerSecond = 20;
const maxProjectedMs = 10 * 60 * 1000;

const entrySource = `
  export { CHOICE_ROWS } from './src/sim/content/choice_rows.ts';
  export { TALENTS } from './src/sim/content/talents.ts';
  export { MOBS } from './src/sim/data.ts';
  export { createMob } from './src/sim/entity.ts';
  export { Sim } from './src/sim/sim.ts';
  export { ALL_CLASSES, MAX_LEVEL } from './src/sim/types.ts';
`;

const build = await esbuild.build({
  stdin: {
    contents: entrySource,
    resolveDir: root,
    sourcefile: 'row-build-sweep-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});

const dataUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString(
  'base64',
)}`;
const { ALL_CLASSES, CHOICE_ROWS, MOBS, MAX_LEVEL, Sim, TALENTS, createMob } = await import(
  dataUrl
);

const damageEffects = new Set([
  'aoeDamage',
  'aoeRoot',
  'directDamage',
  'dot',
  'drainTick',
  'finisherDamage',
  'groundAoE',
  'weaponDamage',
  'weaponStrike',
]);
const healingEffects = new Set(['aoeHeal', 'heal', 'hot']);
const healerClasses = new Set(['paladin', 'priest', 'shaman', 'druid', 'hunter']);
const meleeReach = 2.25;
const approachSpeed = 7;

function face(a, b) {
  a.facing = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
}

function buildCombos(rows, at = 0, picked = [], out = []) {
  if (at >= rows.length) {
    out.push([...picked]);
    return out;
  }
  for (const option of rows[at].options) {
    picked.push({ level: rows[at].level, optionId: option.id });
    buildCombos(rows, at + 1, picked, out);
    picked.pop();
  }
  return out;
}

function hasAnyEffect(ability, set) {
  return ability.effects.some((effect) => set.has(effect.type));
}

function canTryCast(player, ability) {
  if (player.castingAbility) return false;
  if (!ability.def.offGcd && player.gcdRemaining > 0) return false;
  if (player.cooldowns.has(ability.def.id)) return false;
  return true;
}

function setupDummy(sim, player) {
  const dummy = createMob(sim.nextId++, MOBS.forest_wolf, MAX_LEVEL, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 10,
  });
  dummy.name = 'Training Dummy';
  dummy.hostile = true;
  dummy.aiState = 'idle';
  dummy.maxHp = 5000;
  dummy.hp = 5000;
  sim.addEntity(dummy);
  return { dummy, pos: { ...dummy.pos } };
}

function pinDummy(dummy, pos) {
  dummy.dead = false;
  dummy.hp = dummy.maxHp;
  dummy.hostile = true;
  dummy.aiState = 'idle';
  dummy.aggroTargetId = null;
  dummy.targetId = null;
  dummy.pos.x = pos.x;
  dummy.pos.y = pos.y;
  dummy.pos.z = pos.z;
  dummy.vx = 0;
  dummy.vy = 0;
  dummy.vz = 0;
}

function approach(player, target) {
  const dx = target.pos.x - player.pos.x;
  const dz = target.pos.z - player.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= meleeReach || player.castingAbility) return;
  const step = Math.min(dist - meleeReach, approachSpeed / ticksPerSecond);
  player.pos.x += (dx / dist) * step;
  player.pos.z += (dz / dist) * step;
}

function optionIds(build) {
  return build.map((pick) => pick.optionId);
}

function runBuild(cls, build, seconds) {
  const sim = new Sim({ seed: 7300, playerClass: 'warrior', noPlayer: true, autoEquip: true });
  const pid = sim.addPlayer(cls, 'Sweep');
  sim.setPlayerLevel(MAX_LEVEL, pid);
  const specId = TALENTS[cls].specs[0]?.id ?? null;
  // The flip: rows apply as one allocation instead of the old per-pick chooseRow.
  const rows = Object.fromEntries(build.map((pick) => [pick.level, pick.optionId]));
  sim.applyTalents({ spec: specId, rows }, pid);
  const player = sim.entities.get(pid);
  const { dummy, pos } = setupDummy(sim, player);
  sim.targetEntity(dummy.id, pid);
  face(player, dummy);
  sim.startAutoAttack(pid);

  let damage = 0;
  let healing = 0;
  sim.emit = (event) => {
    if (event?.type === 'damage' && event.targetId === dummy.id && event.sourceId === pid) {
      damage += event.amount || 0;
    }
    if (
      (event?.type === 'heal' || event?.type === 'heal2') &&
      event.sourceId === pid &&
      event.amount > 0
    ) {
      healing += event.amount;
    }
  };

  const actionIds = sim
    .meta(pid)
    .known.filter(
      (ability) => hasAnyEffect(ability, damageEffects) || hasAnyEffect(ability, healingEffects),
    )
    .map((ability) => ability.def.id);
  let actionCursor = 0;
  const totalTicks = seconds * ticksPerSecond;
  const isHealer = healerClasses.has(cls);

  for (let tick = 0; tick < totalTicks; tick++) {
    pinDummy(dummy, pos);
    player.resource = player.maxResource;
    if (isHealer && player.hp > Math.floor(player.maxHp * 0.6))
      player.hp = Math.floor(player.maxHp * 0.6);
    face(player, dummy);
    sim.targetEntity(dummy.id, pid);
    approach(player, dummy);

    if (!player.castingAbility && player.gcdRemaining <= 0 && actionIds.length > 0) {
      for (let scan = 0; scan < actionIds.length; scan++) {
        const id = actionIds[(actionCursor + scan) % actionIds.length];
        const ability = sim.resolvedAbility(id, pid);
        if (!ability || !canTryCast(player, ability)) continue;
        const heals = hasAnyEffect(ability, healingEffects);
        if (heals && isHealer) sim.targetEntity(pid, pid);
        const aim =
          ability.def.targetMode === 'position' ? { x: dummy.pos.x, z: dummy.pos.z } : undefined;
        sim.castAbility(id, pid, aim);
        sim.targetEntity(dummy.id, pid);
        actionCursor = (actionCursor + scan + 1) % actionIds.length;
        break;
      }
    }

    sim.tick();
  }

  return {
    options: optionIds(build),
    damage,
    healing,
    dps: damage / seconds,
    hps: healing / seconds,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeClass(cls, rows, seconds) {
  const builds = buildCombos(rows).map((combo) => runBuild(cls, combo, seconds));
  const dpsValues = builds.map((row) => row.dps);
  const medianDps = median(dpsValues);
  const sorted = [...builds].sort((a, b) => a.dps - b.dps);
  const outliers = builds
    .filter((row) => medianDps > 0 && row.dps > medianDps * 1.4)
    .sort((a, b) => b.dps - a.dps);
  return {
    class: cls,
    spec: TALENTS[cls].specs[0]?.id ?? null,
    builds,
    summary: {
      minDps: sorted[0].dps,
      medianDps,
      maxDps: sorted.at(-1).dps,
      top5: [...sorted].reverse().slice(0, 5),
      bottom5: sorted.slice(0, 5),
      outliersAboveMedian40: outliers,
    },
  };
}

const warmupClass = ALL_CLASSES[0];
const warmupBuilds = buildCombos(CHOICE_ROWS[warmupClass].rows).slice(0, 27);
const warmupStart = performance.now();
for (const combo of warmupBuilds) runBuild(warmupClass, combo, fullSeconds);
const warmupMs = performance.now() - warmupStart;
const projectedFullMs = (warmupMs / warmupBuilds.length) * ALL_CLASSES.length * 729;
const seconds = projectedFullMs > maxProjectedMs ? fallbackSeconds : fullSeconds;

const start = performance.now();
const classes = ALL_CLASSES.map((cls) => summarizeClass(cls, CHOICE_ROWS[cls].rows, seconds));
const elapsedMs = performance.now() - start;
const medians = classes.map((entry) => entry.summary.medianDps);
const minMedian = Math.min(...medians);
const maxMedian = Math.max(...medians);
const spreadPct = minMedian > 0 ? ((maxMedian - minMedian) / minMedian) * 100 : null;
const report = {
  generatedAt: new Date().toISOString(),
  seed: 7300,
  level: MAX_LEVEL,
  seconds,
  ticksPerRun: seconds * ticksPerSecond,
  fullRunProjectedMs: Math.round(projectedFullMs),
  elapsedMs: Math.round(elapsedMs),
  classes,
  crossClass: {
    minMedianDps: minMedian,
    maxMedianDps: maxMedian,
    spreadPct,
    medians: classes.map((entry) => ({
      class: entry.class,
      spec: entry.spec,
      medianDps: entry.summary.medianDps,
    })),
  },
};

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(1) : 'n/a';
}

function buildList(rows) {
  return rows.map((row) => `${fmt(row.dps)} (${row.options.join(', ')})`).join('<br>');
}

function markdown(data) {
  const lines = [];
  lines.push('# Talents 2.0 Row Build Sweep');
  lines.push('');
  lines.push(`Generated by \`node scripts/row_build_sweep.mjs\`.`);
  lines.push('');
  lines.push(`Seed: \`${data.seed}\``);
  lines.push(`Level: \`${data.level}\``);
  lines.push(`Duration per build: \`${data.seconds}s\``);
  lines.push(`Ticks per build: \`${data.ticksPerRun}\``);
  lines.push(`Elapsed sweep time: \`${(data.elapsedMs / 1000).toFixed(2)}s\``);
  if (data.seconds !== fullSeconds) {
    lines.push(
      `The warmup projected a full 30 second sweep above 10 minutes, so this report uses 15 seconds per build.`,
    );
  }
  lines.push('');
  lines.push('## Cross Class Summary');
  lines.push('');
  lines.push('| Class | First spec | Median DPS |');
  lines.push('|---|---:|---:|');
  for (const row of data.crossClass.medians) {
    lines.push(`| ${row.class} | ${row.spec ?? 'none'} | ${fmt(row.medianDps)} |`);
  }
  lines.push('');
  lines.push(
    `Cross class median DPS spread: ${fmt(data.crossClass.minMedianDps)} to ${fmt(
      data.crossClass.maxMedianDps,
    )}, ${data.crossClass.spreadPct === null ? 'n/a' : `${fmt(data.crossClass.spreadPct)}%`}.`,
  );
  lines.push('');
  lines.push('## Class Build Ranges');
  lines.push('');
  lines.push('| Class | Min DPS | Median DPS | Max DPS | Top 5 builds | Bottom 5 builds |');
  lines.push('|---|---:|---:|---:|---|---|');
  for (const entry of data.classes) {
    lines.push(
      `| ${entry.class} | ${fmt(entry.summary.minDps)} | ${fmt(entry.summary.medianDps)} | ${fmt(
        entry.summary.maxDps,
      )} | ${buildList(entry.summary.top5)} | ${buildList(entry.summary.bottom5)} |`,
    );
  }
  lines.push('');
  lines.push('## Required Callouts');
  lines.push('');
  lines.push(
    '- Freeze package: Ice Lance, Shatter, and Deep Freeze are represented in mage row builds. The stationary dummy captures direct rooted damage and stun damage, but it does not value control uptime beyond its damage side effects.',
  );
  lines.push(
    '- Priest Silence: Silence appears in priest row builds as a control grant. The stationary dummy does not cast, so this sweep does not measure interrupt value.',
  );
  lines.push(
    '- Mobile Scorch kite potential: Firestarter makes Scorch castable while moving. This stationary dummy sweep does not measure kite value, so the report should not treat mobile Scorch as only its dummy DPS.',
  );
  const outliers = data.classes.flatMap((entry) =>
    entry.summary.outliersAboveMedian40.map((row) => ({
      class: entry.class,
      median: entry.summary.medianDps,
      row,
    })),
  );
  if (outliers.length === 0) {
    lines.push('- Builds more than 40% above class median: none.');
  } else {
    lines.push('- Builds more than 40% above class median:');
    for (const outlier of outliers) {
      const pct = ((outlier.row.dps / outlier.median - 1) * 100).toFixed(1);
      lines.push(
        `  - ${outlier.class}: ${fmt(outlier.row.dps)} DPS, ${pct}% above median, ${outlier.row.options.join(', ')}`,
      );
    }
  }
  lines.push('');
  lines.push('## Method Notes');
  lines.push('');
  lines.push(
    '- Each run creates a fresh Sim, sets level 20, sets the class first spec, applies one row option at each of the six row levels, and spawns a passive 5000 HP Training Dummy at 10 yd.',
  );
  lines.push(
    '- The action driver starts auto attack, approaches into melee after the 10 yd spawn point, restores player resource each tick, and cycles known damaging or healing abilities in keybind order when the GCD, cooldown, and cast state allow.',
  );
  lines.push(
    '- Healing is reported in the raw JSON. For healer classes, the player is kept wounded enough for self heals to produce non-overheal output.',
  );
  return `${lines.join('\n')}\n`;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(mdPath, markdown(report));

console.log(`row build sweep: ${ALL_CLASSES.length * 729} builds, ${seconds}s each`);
console.log(`elapsed: ${(elapsedMs / 1000).toFixed(2)}s`);
console.log('| Class | First spec | Median DPS |');
console.log('|---|---:|---:|');
for (const row of report.crossClass.medians) {
  console.log(`| ${row.class} | ${row.spec ?? 'none'} | ${fmt(row.medianDps)} |`);
}
