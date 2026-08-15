import { formatList, formatNumber, t, tPlural } from '../ui/i18n';
import type { TranslationKey } from '../ui/i18n.catalog';
import type { PerfSnapshot } from './perf';
import type { PerfDiagnosis, PerfDiagnosisFinding } from './perf_diagnosis_core';

const INTEGER: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const ONE_DECIMAL: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };
const PERCENT: Intl.NumberFormatOptions = {
  style: 'percent',
  maximumFractionDigits: 0,
};
const PREFIX = 'hudChrome.perf.diagnostics.diagnosis';

type Values = Parameters<typeof t>[1];
type FindingFamily =
  | 'environment'
  | 'gpu'
  | 'scene'
  | 'shadow'
  | 'rendererCpu'
  | 'mainCpu'
  | 'hitch'
  | 'asset'
  | 'browser'
  | 'network'
  | 'snapshot'
  | 'generic';

const TITLE_KEYS: Readonly<Record<string, TranslationKey>> = {
  'system-hardware-acceleration': `${PREFIX}.titles.hardwareAcceleration`,
  'system-integrated-gpu': `${PREFIX}.titles.integratedGpu`,
  'system-high-dpi': `${PREFIX}.titles.highDpi`,
  'system-forced-high-graphics': `${PREFIX}.titles.forcedHighGraphics`,
  'system-low-memory': `${PREFIX}.titles.lowMemory`,
  'system-browser-stalls': `${PREFIX}.titles.browserStalls`,
  'system-heap-pressure': `${PREFIX}.titles.heapPressure`,
  'system-context-loss': `${PREFIX}.titles.contextLoss`,
  'gpu-submit-bound': `${PREFIX}.titles.gpuSubmit`,
  'scene-draw-pressure': `${PREFIX}.titles.sceneDraw`,
  'shadow-pass-pressure': `${PREFIX}.titles.shadowPass`,
  'renderer-world-cpu': `${PREFIX}.titles.rendererWorld`,
  'renderer-entities-cpu': `${PREFIX}.titles.rendererEntities`,
  'renderer-nameplates-cpu': `${PREFIX}.titles.rendererNameplates`,
  'sim-cpu': `${PREFIX}.titles.simCpu`,
  'hud-cpu': `${PREFIX}.titles.hudCpu`,
  'event-cpu': `${PREFIX}.titles.eventCpu`,
  'hitch-shader-compile': `${PREFIX}.titles.shaderCompile`,
  'hitch-texture-upload': `${PREFIX}.titles.textureUpload`,
  'hitch-view-create': `${PREFIX}.titles.viewCreate`,
  'hitch-other': `${PREFIX}.titles.otherHitch`,
  'asset-startup': `${PREFIX}.titles.assetStartup`,
  'main-thread-long-tasks': `${PREFIX}.titles.longTasks`,
  'network-latency': `${PREFIX}.titles.networkLatency`,
  'snapshot-apply-cpu': `${PREFIX}.titles.snapshotApply`,
};

function tr(key: TranslationKey, values?: Values): string {
  return t(key, values);
}

function copyFamily(
  family: FindingFamily,
): 'environment' | 'graphics' | 'cpu' | 'loading' | 'network' {
  if (family === 'environment' || family === 'browser') return 'environment';
  if (family === 'gpu' || family === 'scene' || family === 'shadow') return 'graphics';
  if (family === 'rendererCpu' || family === 'mainCpu') return 'cpu';
  if (family === 'asset' || family === 'hitch') return 'loading';
  return 'network';
}

function familyFor(id: string): FindingFamily {
  if (id.startsWith('system-')) return 'environment';
  if (id === 'gpu-submit-bound') return 'gpu';
  if (id === 'scene-draw-pressure') return 'scene';
  if (id === 'shadow-pass-pressure') return 'shadow';
  if (id.startsWith('renderer-')) return 'rendererCpu';
  if (id === 'sim-cpu' || id === 'hud-cpu' || id === 'event-cpu') return 'mainCpu';
  if (id.startsWith('hitch-')) return 'hitch';
  if (id === 'asset-startup') return 'asset';
  if (id === 'main-thread-long-tasks') return 'browser';
  if (id === 'network-latency') return 'network';
  if (id === 'snapshot-apply-cpu') return 'snapshot';
  return 'generic';
}

function milliseconds(value: number): string {
  return t('hudChrome.perf.units.ms', {
    value: formatNumber(value, ONE_DECIMAL),
  });
}

function count(value: number): string {
  return formatNumber(value, INTEGER);
}

function percentage(value: number): string {
  return formatNumber(value, PERCENT);
}

function cpuPhaseValue(id: string, snapshot: PerfSnapshot): number {
  if (id === 'renderer-world-cpu') return snapshot.renderer?.phaseMs.world.p95 ?? 0;
  if (id === 'renderer-entities-cpu') return snapshot.renderer?.phaseMs.entities.p95 ?? 0;
  if (id === 'renderer-nameplates-cpu') return snapshot.renderer?.phaseMs.nameplates.p95 ?? 0;
  if (id === 'sim-cpu') return snapshot.mainMs.sim.p95;
  if (id === 'hud-cpu') return snapshot.mainMs.hud.p95;
  return snapshot.mainMs.events.p95;
}

function localizedEvidence(finding: PerfDiagnosisFinding, snapshot: PerfSnapshot): string[] {
  const renderer = snapshot.renderer;
  switch (familyFor(finding.id)) {
    case 'environment':
      return [
        tr(`${PREFIX}.evidence.environment`, {
          rule: finding.id.slice('system-'.length),
        }),
      ];
    case 'gpu': {
      const submit = renderer?.phaseMs.submit.p95 ?? 0;
      const total = Math.max(0.01, renderer?.phaseMs.total.p95 ?? 0);
      return [
        tr(`${PREFIX}.evidence.gpuSubmit`, {
          submit: milliseconds(submit),
          share: percentage(submit / total),
        }),
        tr(`${PREFIX}.evidence.frame`, {
          fps: formatNumber(snapshot.windows.last10s.fps, ONE_DECIMAL),
          p95: milliseconds(snapshot.windows.last10s.frameMs.p95),
        }),
      ];
    }
    case 'scene': {
      const caps = renderer?.renderBudget.caps;
      const top = snapshot.census?.rows.slice().sort((a, b) => b.calls - a.calls)[0];
      return [
        tr(`${PREFIX}.evidence.sceneCalls`, {
          calls: count(renderer?.calls ?? 0),
          target: count(caps?.targetCalls ?? 0),
        }),
        tr(`${PREFIX}.evidence.sceneTriangles`, {
          triangles: count(renderer?.triangles ?? 0),
          target: count(caps?.targetTriangles ?? 0),
        }),
        ...(top
          ? [
              tr(`${PREFIX}.evidence.sceneCategory`, {
                category: top.category,
                calls: count(top.calls),
                triangles: count(top.triangles),
              }),
            ]
          : [tr(`${PREFIX}.evidence.censusNeeded`)]),
      ];
    }
    case 'shadow':
      return [
        tr(`${PREFIX}.evidence.shadow`, {
          calls: count(snapshot.census?.shadow.calls ?? 0),
          share: percentage(snapshot.census?.shadow.callsShare ?? 0),
          triangles: count(snapshot.census?.shadow.triangles ?? 0),
        }),
      ];
    case 'rendererCpu':
    case 'mainCpu':
      return [
        tr(`${PREFIX}.evidence.cpuPhase`, {
          phase: finding.id,
          p95: milliseconds(cpuPhaseValue(finding.id, snapshot)),
        }),
      ];
    case 'hitch': {
      const cause = finding.id.slice('hitch-'.length) as keyof NonNullable<
        PerfSnapshot['hitches']
      >['byCause'];
      return [
        tr(`${PREFIX}.evidence.hitch`, {
          cause,
          count: count(snapshot.hitches?.byCause[cause] ?? 0),
          total: count(snapshot.hitches?.hitches ?? 0),
        }),
      ];
    }
    case 'asset': {
      const failed = Object.entries(snapshot.assets.byType)
        .filter(([, value]) => value.failed > 0)
        .map(([name]) => name);
      return [
        tr(`${PREFIX}.evidence.assets`, {
          wait: milliseconds(snapshot.assets.preload.waitMs),
          tasks: count(snapshot.assets.preload.tasks),
        }),
        ...(failed.length > 0
          ? [tr(`${PREFIX}.evidence.failedAssets`, { groups: formatList(failed) })]
          : []),
      ];
    }
    case 'browser':
      return [
        tr(`${PREFIX}.evidence.longTasks`, {
          count: count(snapshot.browser.longTasks.count),
          p95: milliseconds(snapshot.browser.longTasks.p95),
          max: milliseconds(snapshot.browser.longTasks.max),
        }),
      ];
    case 'network':
      return [
        tr(`${PREFIX}.evidence.network`, {
          interval: milliseconds(snapshot.network?.snapInterval ?? 0),
          age: milliseconds(snapshot.network?.lastSnapAge ?? 0),
          echo: milliseconds(snapshot.input.sendToEcho.p95),
        }),
      ];
    case 'snapshot': {
      const parseApply =
        (snapshot.netPipeline?.parseMs.p95 ?? 0) + (snapshot.netPipeline?.applyMs.p95 ?? 0);
      return [
        tr(`${PREFIX}.evidence.snapshot`, {
          work: milliseconds(parseApply),
          gap: milliseconds(snapshot.netPipeline?.gapMs.p95 ?? 0),
        }),
      ];
    }
    case 'generic':
      return [tr(`${PREFIX}.evidence.generic`, { rule: finding.id })];
  }
}

function localizedFinding(
  finding: PerfDiagnosisFinding,
  snapshot: PerfSnapshot,
): PerfDiagnosisFinding {
  const family = familyFor(finding.id);
  const presentationFamily = copyFamily(family);
  const titleKey = TITLE_KEYS[finding.id] ?? `${PREFIX}.titles.generic`;
  return {
    ...finding,
    title: tr(titleKey, { rule: finding.id }),
    cause: tr(`${PREFIX}.causes.${presentationFamily}`),
    evidence: localizedEvidence(finding, snapshot),
    immediateFixes: [tr(`${PREFIX}.tryNow.${presentationFamily}`)],
    codeFixes: [tr(`${PREFIX}.codeFix.${presentationFamily}`)],
    ...(finding.action
      ? {
          action: {
            ...finding.action,
            label: t('hudChrome.perf.diagnostics.controls.retestLowGraphics'),
          },
        }
      : {}),
  };
}

/**
 * Converts the analyzer's stable rule output into catalog-backed presentation copy.
 * The panel and copied report only receive this localized representation.
 */
export function localizePerfDiagnosis(
  diagnosis: PerfDiagnosis,
  snapshot: PerfSnapshot,
): PerfDiagnosis {
  const findings = diagnosis.findings.map((finding) => localizedFinding(finding, snapshot));
  const recent = snapshot.windows.last10s;
  const headline = findings[0]?.title ?? tr(`${PREFIX}.noProblemTitle`);
  const summary =
    findings.length > 0
      ? tPlural(`${PREFIX}.summary.findings`, findings.length, {
          findings: count(findings.length),
          fps: formatNumber(recent.fps, ONE_DECIMAL),
          p95: milliseconds(recent.frameMs.p95),
        })
      : tr(`${PREFIX}.summary.healthy`, {
          fps: formatNumber(recent.fps, ONE_DECIMAL),
          p95: milliseconds(recent.frameMs.p95),
        });
  return { ...diagnosis, headline, summary, findings };
}
