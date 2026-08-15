import { formatDateTime, formatNumber, t } from '../ui/i18n';
import type { PerfSnapshot } from './perf';
import { localizePerfDiagnosis } from './perf_diagnosis_i18n';
import {
  analyzePerfSuggestions,
  type PerfSuggestion,
  type PerfSuggestionId,
  type PerfSuggestionSeverity,
} from './perf_doctor';

export type PerfDiagnosisConfidence = 'high' | 'medium' | 'low';

export interface PerfDiagnosisFinding {
  id: string;
  severity: PerfSuggestionSeverity;
  confidence: PerfDiagnosisConfidence;
  title: string;
  cause: string;
  evidence: string[];
  immediateFixes: string[];
  codeFixes: string[];
  sourceFiles: string[];
  action?: { label: string; href: string };
}

export interface PerfDiagnosis {
  status: 'healthy' | 'needs-attention' | 'critical';
  score: number;
  headline: string;
  summary: string;
  findings: PerfDiagnosisFinding[];
}

export interface PerfDiagnosisReportContext {
  capturedAt?: string;
}

const SEVERITY_WEIGHT: Record<PerfSuggestionSeverity, number> = {
  critical: 35,
  warning: 15,
  info: 5,
};

const MATERIAL_VIEW_CREATE_HITCH_MS = 50;

const CATEGORY_SOURCE: Record<string, { files: string[]; fix: string; label: string }> = {
  foliage: {
    files: ['src/render/foliage.ts', 'src/render/render_budget.ts'],
    fix: 'Reduce visible foliage buckets, merge repeated meshes, or move the expensive band behind the existing foliage budget level.',
    label: 'Foliage',
  },
  props: {
    files: ['src/render/props.ts', 'src/render/placed_assets.ts'],
    fix: 'Instance repeated props, merge one-off geometry by material and z band, and tighten distance culling for purely decorative pieces.',
    label: 'World props and town assets',
  },
  terrain: {
    files: ['src/render/terrain.ts', 'src/render/far_terrain.ts'],
    fix: 'Check terrain chunk LOD, splat material count, and the near-to-far handoff. Keep terrain height sourced from the sim helpers.',
    label: 'Terrain',
  },
  water: {
    files: ['src/render/water.ts', 'src/render/water_simulation.ts'],
    fix: 'Reduce off-screen simulation passes, lower cosmetic water resolution through the existing tier controls, and confirm sleeping fields stay asleep.',
    label: 'Water',
  },
  vfx: {
    files: ['src/render/vfx.ts', 'src/render/render_budget.ts'],
    fix: 'Pool the effect, cap cosmetic particle density, and connect its fade to the existing VFX budget level instead of adding a new governor.',
    label: 'Visual effects',
  },
  dungeon: {
    files: ['src/render/dungeon.ts'],
    fix: 'Merge static dungeon geometry by material, instance repeated kit pieces, and tighten room visibility or distance culling.',
    label: 'Dungeon geometry',
  },
  sky: {
    files: ['src/render/sky.ts', 'src/render/post.ts'],
    fix: 'Check full-screen sky and post passes, and keep expensive cosmetic passes controlled by the shared graphics tier.',
    label: 'Sky and post processing',
  },
  ambient: {
    files: ['src/render/birds.ts', 'src/render/motes.ts'],
    fix: 'Reduce cosmetic spawn density and skip updates when the ambient system is outside the visible camera region.',
    label: 'Ambient particles and wildlife',
  },
  ui3d: {
    files: ['src/render/renderer.ts', 'src/render/nameplate_painter.ts'],
    fix: 'Reuse materials and geometry for 3D UI markers, and confirm cadence and distance gates skip work for hidden markers.',
    label: '3D UI markers',
  },
};

function categoryAdvice(category: string): { files: string[]; fix: string; label: string } {
  if (category.startsWith('entity:')) {
    return {
      files: ['src/render/renderer.ts', 'src/render/characters/', 'src/render/crowd_lod.ts'],
      fix: 'Reuse character rigs, avoid rebuilding views, and move distant actors through the existing crowd LOD bands before reducing gameplay information.',
      label: `${category.slice('entity:'.length)} entity views`,
    };
  }
  return (
    CATEGORY_SOURCE[category] ?? {
      files: ['src/render/renderer.ts'],
      fix: 'Inspect this scene bucket for unshared materials, repeated uninstanced meshes, missing culling, or work performed while its subtree is hidden.',
      label: category,
    }
  );
}

function lowGraphicsHref(search: string): string {
  const params = new URLSearchParams(search);
  params.set('gfx', 'low');
  params.set('diagnostics', '1');
  return `?${params.toString()}`;
}

function systemFixes(id: PerfSuggestionId): {
  immediate: string[];
  code: string[];
  files: string[];
} {
  switch (id) {
    case 'hardware-acceleration':
      return {
        immediate: [
          'Enable browser hardware acceleration, restart the browser, and update the GPU driver.',
          'On Windows, set the browser to High performance under Settings > System > Display > Graphics.',
        ],
        code: [
          'Keep software renderer detection mapped to the low graphics tier and avoid effects that bypass that tier.',
        ],
        files: ['src/render/software_renderer.ts', 'src/render/gfx.ts'],
      };
    case 'integrated-gpu':
      return {
        immediate: [
          'If the machine has a gaming GPU, set the browser to High performance in Windows graphics settings and restart it.',
          'Retest in the desktop app, which already requests the high-performance GPU.',
        ],
        code: ['Keep the integrated GPU path within the current graphics budget and LOD limits.'],
        files: ['src/render/gfx.ts', 'src/render/render_budget.ts'],
      };
    case 'high-dpi':
      return {
        immediate: [
          'Retest on Low graphics. A large improvement confirms pixel cost as the primary bottleneck.',
          'Reduce browser zoom or display scaling only as a temporary confirmation step.',
        ],
        code: [
          'Tune dynamic resolution through src/render/render_budget.ts. Do not add a second resolution governor.',
        ],
        files: ['src/render/render_budget.ts', 'src/render/gfx.ts'],
      };
    case 'forced-high-graphics':
      return {
        immediate: [
          'Remove the forced gfx query or select Auto or Low graphics and rerun the scan.',
        ],
        code: ['Keep new cosmetic work behind the shared graphics tier and render budget.'],
        files: ['src/render/gfx.ts', 'src/render/render_budget.ts'],
      };
    case 'low-memory':
      return {
        immediate: [
          'Close other tabs and applications, then reload and rerun the scan on Low graphics.',
        ],
        code: [
          'Release decoded asset caches after extraction, keep world assets in the deferred preload lane, and avoid retaining cloned textures.',
        ],
        files: ['src/render/assets/preload.ts', 'src/render/assets/loader.ts'],
      };
    case 'browser-stalls':
      return {
        immediate: [
          'Disable extensions for localhost and rerun the scan in a clean browser profile.',
        ],
        code: [
          'Enable the local dev trace, find the nearest named main-thread scope, then split or defer it.',
        ],
        files: ['src/game/perf.ts', 'src/main.ts'],
      };
    case 'heap-pressure':
      return {
        immediate: ['Reload the game, close other tabs, and compare a fresh 15-second scan.'],
        code: [
          'Inspect long-lived caches and per-frame allocation. Reuse scratch arrays and vectors in renderer hot paths.',
        ],
        files: ['src/render/renderer.ts', 'src/render/assets/loader.ts'],
      };
    case 'context-loss':
      return {
        immediate: ['Switch to Low graphics, update the GPU driver, and restart the browser.'],
        code: [
          'Reduce peak GPU memory and upload bursts. Verify context restoration does not recreate duplicate resources.',
        ],
        files: ['src/render/renderer.ts', 'src/render/assets/loader.ts'],
      };
  }
}

function diagnosisFromSuggestion(suggestion: PerfSuggestion): PerfDiagnosisFinding {
  const fixes = systemFixes(suggestion.id);
  return {
    id: `system-${suggestion.id}`,
    severity: suggestion.severity,
    confidence: suggestion.id === 'integrated-gpu' ? 'medium' : 'high',
    title: suggestion.title,
    cause: suggestion.body,
    evidence: [`Detected by the ${suggestion.id} environment rule.`],
    immediateFixes: fixes.immediate,
    codeFixes: fixes.code,
    sourceFiles: fixes.files,
    ...(suggestion.action ? { action: suggestion.action } : {}),
  };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ms(value: number): string {
  return `${Math.round(value * 10) / 10} ms`;
}

function addFinding(findings: PerfDiagnosisFinding[], finding: PerfDiagnosisFinding): void {
  if (!findings.some((item) => item.id === finding.id)) findings.push(finding);
}

function badFrameWindow(snapshot: PerfSnapshot): boolean {
  const recent = snapshot.windows.last10s;
  return (
    recent.frames !== 0 &&
    (recent.fps < 45 || recent.frameMs.p95 >= 28 || recent.frameMs.long50 >= 3)
  );
}

/**
 * Turns the game's detailed perf snapshot into a ranked, source-specific report.
 * This stays a pure analyzer. perf_diagnostics_panel.ts owns all DOM work.
 */
export function diagnosePerfSnapshot(
  snapshot: PerfSnapshot,
  search = '',
  env: { desktopShell: boolean } = { desktopShell: false },
): PerfDiagnosis {
  const findings: PerfDiagnosisFinding[] = analyzePerfSuggestions(snapshot, search, env).map(
    diagnosisFromSuggestion,
  );
  const recent = snapshot.windows.last10s;
  const slowFrames = badFrameWindow(snapshot);
  const renderer = snapshot.renderer;

  if (renderer && slowFrames) {
    const phases = renderer.phaseMs;
    const totalP95 = Math.max(0.01, phases.total.p95);
    const submitShare = phases.submit.p95 / totalP95;
    const submitReason =
      renderer.renderBudget.reason === 'submit' || renderer.renderBudget.reason === 'submit-stall';
    if (phases.submit.p95 >= 12 && (submitShare >= 0.4 || submitReason)) {
      addFinding(findings, {
        id: 'gpu-submit-bound',
        severity: renderer.renderBudget.recentSubmitStalls > 0 ? 'critical' : 'warning',
        confidence: submitReason || submitShare >= 0.6 ? 'high' : 'medium',
        title: 'GPU submission is the main frame bottleneck',
        cause:
          'The CPU is waiting for WebGL submission or GPU work to finish. Resolution, shadows, post processing, draw calls, and triangle load are the likely levers.',
        evidence: [
          `Submit p95 is ${ms(phases.submit.p95)}, ${pct(submitShare)} of renderer p95.`,
          `The adaptive budget reason is ${renderer.renderBudget.reason} with pressure ${Math.round(renderer.renderBudget.pressure * 100)}%.`,
          `The frame p95 is ${ms(recent.frameMs.p95)} at ${recent.fps} FPS.`,
        ],
        immediateFixes: [
          'Retest on Low graphics. A large improvement confirms GPU or pixel pressure.',
          'Run the scene census and act on its largest call and triangle bucket.',
        ],
        codeFixes: [
          'Use the existing render budget levels for resolution, lighting, foliage, and VFX. Do not create a parallel governor.',
          'Check the largest scene bucket for instancing, material sharing, LOD, and hidden-subtree skips.',
        ],
        sourceFiles: ['src/render/render_budget.ts', 'src/render/renderer.ts', 'src/render/gfx.ts'],
        action: { label: 'Retest on Low graphics', href: lowGraphicsHref(search) },
      });
    }

    const caps = renderer.renderBudget.caps;
    const callRatio = caps.targetCalls > 0 ? renderer.calls / caps.targetCalls : 0;
    const triangleRatio = caps.targetTriangles > 0 ? renderer.triangles / caps.targetTriangles : 0;
    if (callRatio >= 1.05 || triangleRatio >= 1.05) {
      const census = snapshot.census;
      const topCall = census?.rows.slice().sort((a, b) => b.calls - a.calls)[0];
      const topTriangle = census?.rows.slice().sort((a, b) => b.triangles - a.triangles)[0];
      const dominant = callRatio >= triangleRatio ? topCall : topTriangle;
      const advice = categoryAdvice(dominant?.category ?? 'unknown');
      addFinding(findings, {
        id: 'scene-draw-pressure',
        severity:
          renderer.calls >= caps.urgentCalls || renderer.triangles >= caps.urgentTriangles
            ? 'critical'
            : 'warning',
        confidence: census ? 'high' : 'medium',
        title: census
          ? `${advice.label} dominates the expensive scene`
          : 'Scene draw cost is over the active graphics budget',
        cause:
          'The live scene exceeds the tier target for draw calls or triangles. This is game render content, not browser overhead.',
        evidence: [
          `${renderer.calls} calls against a ${caps.targetCalls} target (${pct(callRatio)}).`,
          `${formatNumber(renderer.triangles, { maximumFractionDigits: 0 })} triangles against a ${formatNumber(caps.targetTriangles, { maximumFractionDigits: 0 })} target (${pct(triangleRatio)}).`,
          ...(dominant
            ? [
                `${dominant.category} accounts for ${dominant.calls} calls and ${formatNumber(dominant.triangles, { maximumFractionDigits: 0 })} measured triangles.`,
              ]
            : ['Run the scene census to identify the owning render category.']),
        ],
        immediateFixes: [
          'Run the scene census if it has not completed yet.',
          'Retest the same camera position on Low graphics to separate tier-controlled cost from fixed cost.',
        ],
        codeFixes: [advice.fix],
        sourceFiles: advice.files,
      });
    }

    if (snapshot.census?.shadow.measured && snapshot.census.shadow.callsShare >= 0.3) {
      addFinding(findings, {
        id: 'shadow-pass-pressure',
        severity: 'warning',
        confidence: 'high',
        title: 'The shadow pass is consuming a large share of draw calls',
        cause:
          'Shadow-casting geometry is drawn again into the shadow map, so dense props and actors multiply their cost.',
        evidence: [
          `${snapshot.census.shadow.calls} shadow calls, ${pct(snapshot.census.shadow.callsShare)} of the measured baseline.`,
          `${formatNumber(snapshot.census.shadow.triangles, { maximumFractionDigits: 0 })} triangles are submitted to the shadow pass.`,
        ],
        immediateFixes: ['Retest on Low graphics, where the shared tier reduces shadow cost.'],
        codeFixes: [
          'Disable castShadow on small decorative meshes, share instanced shadow casters, and keep the shadow map controlled by the lighting budget level.',
        ],
        sourceFiles: ['src/render/renderer.ts', 'src/render/gfx.ts'],
      });
    }

    const cpuPhases = [
      {
        id: 'renderer-world-cpu',
        label: 'World renderer updates are CPU-bound',
        value: phases.world.p95,
        threshold: 8,
        source: ['src/render/renderer.ts', 'src/render/terrain.ts', 'src/render/foliage.ts'],
        fix: 'Use the last-frame world phase breakdown to find the slow subsystem, then skip hidden work and remove per-frame allocation from that module.',
      },
      {
        id: 'renderer-entities-cpu',
        label: 'Entity view updates are CPU-bound',
        value: phases.entities.p95,
        threshold: 8,
        source: ['src/render/renderer.ts', 'src/render/characters/', 'src/render/crowd_lod.ts'],
        fix: 'Reduce view churn, reuse rigs and scratch objects, and confirm distant actors use the current crowd LOD cadence.',
      },
      {
        id: 'renderer-nameplates-cpu',
        label: 'Nameplate painting is expensive',
        value: phases.nameplates.p95,
        threshold: 4,
        source: ['src/render/nameplate_painter.ts', 'src/render/nameplate_view.ts'],
        fix: 'Preserve the allocation-free view plan, increase cosmetic repaint elision, and avoid DOM or layout work for culled nameplates.',
      },
    ];
    for (const phase of cpuPhases) {
      if (phase.value < phase.threshold || phases.submit.p95 > phase.value * 1.5) continue;
      addFinding(findings, {
        id: phase.id,
        severity: phase.value >= phase.threshold * 2 ? 'critical' : 'warning',
        confidence: phase.value >= phase.threshold * 1.5 ? 'high' : 'medium',
        title: phase.label,
        cause:
          'A CPU-side renderer phase is consuming a large part of the frame before WebGL submission.',
        evidence: [`This phase has a p95 of ${ms(phase.value)}.`],
        immediateFixes: [
          'Hold the same camera position and rerun the scan to confirm the phase remains dominant.',
        ],
        codeFixes: [phase.fix],
        sourceFiles: phase.source,
      });
    }
  }

  const mainCpu = [
    {
      id: 'sim-cpu',
      label: 'Simulation work is consuming the frame',
      value: snapshot.mainMs.sim.p95,
      threshold: 8,
      fix: 'Profile the fixed 20 Hz sim tick, remove repeated scans, and preserve determinism. Do not move presentation work into src/sim.',
      source: ['src/sim/', 'src/sim/sim.ts'],
    },
    {
      id: 'hud-cpu',
      label: 'HUD updates are consuming the frame',
      value: snapshot.mainMs.hud.p95,
      threshold: 6,
      fix: 'Use PainterHost write elision, avoid forced layout reads, and keep hot painters on their registered cadence.',
      source: ['src/ui/hud.ts', 'src/ui/painter_host.ts', 'tests/hud_perf_budget.test.ts'],
    },
    {
      id: 'event-cpu',
      label: 'Event processing is consuming the frame',
      value: snapshot.mainMs.events.p95,
      threshold: 5,
      fix: 'Batch repeated event work, avoid rebuilding unchanged UI state, and move pure transformation into a tested core.',
      source: ['src/main.ts', 'src/ui/hud.ts'],
    },
  ];
  if (slowFrames) {
    for (const item of mainCpu) {
      if (item.value < item.threshold) continue;
      addFinding(findings, {
        id: item.id,
        severity: item.value >= item.threshold * 2 ? 'critical' : 'warning',
        confidence: item.value >= item.threshold * 1.5 ? 'high' : 'medium',
        title: item.label,
        cause: 'The measured main-thread bucket is large enough to miss the frame budget.',
        evidence: [`The ${item.id} bucket has a p95 of ${ms(item.value)}.`],
        immediateFixes: [
          'Repeat the scan while idle, then while moving, to identify which interaction activates the cost.',
        ],
        codeFixes: [item.fix],
        sourceFiles: item.source,
      });
    }
  }

  const hitches = snapshot.hitches;
  if (hitches && hitches.hitches > 0) {
    const hitchRules = [
      {
        key: 'shader-compile' as const,
        title: 'Shaders are compiling during gameplay',
        fix: 'Add the exact late material or variant to the existing renderer prewarm manifest. Keep customProgramCacheKey stable and clone patched materials through material_clone_hooks.ts.',
        files: ['src/render/renderer.ts', 'src/render/material_clone_hooks.ts'],
      },
      {
        key: 'texture-upload' as const,
        title: 'Texture uploads are causing gameplay hitches',
        fix: 'Move the asset into the deferred boot preload lane, compress large textures, and avoid first-use uploads inside a visible frame.',
        files: ['src/render/assets/preload.ts', 'src/render/assets/loader.ts'],
      },
      {
        key: 'view-create' as const,
        title: 'Entity view creation is causing hitches',
        fix: 'Pool or prewarm the recurring visual, and spread unavoidable construction over the existing world-streaming budget.',
        files: ['src/render/renderer.ts', 'src/render/view_create_retry.ts'],
      },
      {
        key: 'other' as const,
        title: 'Unattributed long frames remain',
        fix: 'Rerun locally with ?perfTrace=1 and inspect devTrace.frames, spans, and longTasks for the nearest named scope.',
        files: ['src/game/perf.ts', 'src/main.ts'],
      },
    ];
    for (const rule of hitchRules) {
      if (rule.key === 'other' && !slowFrames) continue;
      const count = hitches.byCause[rule.key];
      if (count <= 0) continue;
      // A single lazily streamed view on a 33 ms sample is expected open-world
      // churn and does not establish causation: one missed vsync can coincide
      // with an otherwise cheap pooled view. Keep reporting repeated events or
      // a view creation observed on a materially long (50 ms+) frame.
      if (
        rule.key === 'view-create' &&
        count === 1 &&
        !hitches.recent.some(
          (hitch) =>
            hitch.cause === 'view-create' && hitch.frameMs >= MATERIAL_VIEW_CREATE_HITCH_MS,
        )
      ) {
        continue;
      }
      addFinding(findings, {
        id: `hitch-${rule.key}`,
        severity: count >= 3 ? 'critical' : 'warning',
        confidence: rule.key === 'other' ? 'medium' : 'high',
        title: rule.title,
        cause:
          rule.key === 'other'
            ? 'Some sampled frames exceeded the renderer hitch threshold without a matching program, texture, or view-count change.'
            : 'The renderer recorded a frame over the hitch threshold at the same time this resource count changed.',
        evidence: [
          `${count} of ${hitches.hitches} recorded hitches were attributed to ${rule.key}.`,
          ...(rule.key === 'shader-compile'
            ? [`${hitches.programsAdded} shader programs were added after tracking began.`]
            : []),
        ],
        immediateFixes: [
          'Repeat the same movement path to confirm the hitch occurs at the same location or first-use action.',
        ],
        codeFixes: [rule.fix],
        sourceFiles: rule.files,
      });
    }
  }

  const failedAssets = Object.entries(snapshot.assets.byType).filter(
    ([, value]) => value.failed > 0,
  );
  if (snapshot.assets.preload.waitMs >= 5000 || failedAssets.length > 0) {
    const slowest = Object.values(snapshot.assets.byType)
      .flatMap((value) => value.slowest)
      .sort((a, b) => b.ms - a.ms)[0];
    addFinding(findings, {
      id: 'asset-startup',
      severity: failedAssets.length > 0 ? 'critical' : 'warning',
      confidence: 'high',
      title:
        failedAssets.length > 0 ? 'Game assets failed to preload' : 'Game startup is asset-bound',
      cause:
        'World entry waits for the registered asset preload set, so slow or failed GLB, texture, or HDR work directly delays play.',
      evidence: [
        `The preload gate waited ${Math.round(snapshot.assets.preload.waitMs)} ms for ${snapshot.assets.preload.tasks} tasks.`,
        ...(failedAssets.length > 0
          ? [`Failed asset groups: ${failedAssets.map(([name]) => name).join(', ')}.`]
          : []),
        ...(slowest
          ? [`The slowest recorded asset is ${slowest.url} at ${Math.round(slowest.ms)} ms.`]
          : []),
      ],
      immediateFixes: [
        'Use a wired connection for the first checkout and confirm the browser cache is enabled.',
      ],
      codeFixes: [
        'Keep world content in registerDeferredPreload, compress textures and GLBs, and release immutable loader cache entries after geometry extraction.',
      ],
      sourceFiles: ['src/render/assets/preload.ts', 'src/render/assets/loader.ts'],
    });
  }

  if (slowFrames && snapshot.browser.longTasks.count >= 3 && snapshot.browser.longTasks.p95 >= 50) {
    const finding: PerfDiagnosisFinding = {
      id: 'main-thread-long-tasks',
      severity: snapshot.browser.longTasks.p95 >= 120 ? 'critical' : 'warning',
      confidence: 'high',
      title: 'Long browser tasks are blocking frames',
      cause:
        'JavaScript, garbage collection, or an extension is monopolizing the browser main thread.',
      evidence: [
        `${snapshot.browser.longTasks.count} long tasks, p95 ${ms(snapshot.browser.longTasks.p95)}, max ${ms(snapshot.browser.longTasks.max)}.`,
      ],
      immediateFixes: [
        'Rerun with extensions disabled. If the tasks remain, enable ?perfTrace=1 on localhost and copy the JSON report.',
      ],
      codeFixes: [
        'Use the nearest devTrace span to split, batch, or defer the named scope. Remove per-frame object creation before changing visual quality.',
      ],
      sourceFiles: ['src/game/perf.ts', 'src/main.ts'],
    };
    const existingIndex = findings.findIndex((item) => item.id === 'system-browser-stalls');
    if (existingIndex >= 0) findings[existingIndex] = finding;
    else findings.push(finding);
  }

  const pipeline = snapshot.netPipeline;
  const echoP95 = snapshot.input.sendToEcho.p95;
  if (
    snapshot.network &&
    (snapshot.network.lastSnapAge >= 500 ||
      snapshot.network.snapInterval >= 120 ||
      echoP95 >= 180 ||
      (pipeline &&
        (pipeline.parseMs.p95 + pipeline.applyMs.p95 >= 10 || pipeline.gapMs.p95 >= 120)))
  ) {
    const parseApply = pipeline ? pipeline.parseMs.p95 + pipeline.applyMs.p95 : 0;
    const networkBound = !pipeline || parseApply < 10;
    addFinding(findings, {
      id: networkBound ? 'network-latency' : 'snapshot-apply-cpu',
      severity:
        snapshot.network.lastSnapAge >= 1000 || echoP95 >= 300 || parseApply >= 20
          ? 'critical'
          : 'warning',
      confidence: 'high',
      title: networkBound
        ? 'Network delivery is delaying visible response'
        : 'Snapshot parsing and application are blocking the client',
      cause: networkBound
        ? 'Server snapshots or input echoes are arriving too slowly or irregularly.'
        : 'The browser is spending too much main-thread time parsing and applying online snapshots.',
      evidence: [
        `Snapshot interval ${snapshot.network.snapInterval} ms, latest snapshot age ${snapshot.network.lastSnapAge} ms.`,
        `Input send-to-echo p95 is ${ms(echoP95)}.`,
        ...(pipeline
          ? [
              `Snapshot parse plus apply p95 is ${ms(parseApply)}, network gap p95 is ${ms(pipeline.gapMs.p95)}.`,
            ]
          : []),
      ],
      immediateFixes: [
        'Compare Play Offline with the same camera path. Smooth offline play confirms the network path is responsible.',
      ],
      codeFixes: networkBound
        ? ['Inspect server tick, interest snapshot size, WebSocket delivery, and reconnect resets.']
        : [
            'Reduce snapshot payload churn and repeated client-side entity work without weakening the authoritative server model.',
          ],
      sourceFiles: networkBound
        ? ['server/game.ts', 'src/net/online.ts']
        : ['src/net/net_pipeline_stats.ts', 'src/net/online.ts'],
    });
  }

  const severityRank: Record<PerfSuggestionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1),
  );
  const score = Math.max(
    0,
    100 - findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0),
  );
  const status = findings.some((finding) => finding.severity === 'critical')
    ? 'critical'
    : findings.some((finding) => finding.severity === 'warning')
      ? 'needs-attention'
      : 'healthy';
  const headline = findings[0]?.title ?? 'No material performance problem detected';
  const summary =
    findings.length > 0
      ? `${findings.length} actionable finding${findings.length === 1 ? '' : 's'} from the last 10 seconds at ${recent.fps} FPS and ${ms(recent.frameMs.p95)} frame p95.`
      : `The last 10 seconds held ${recent.fps} FPS with a ${ms(recent.frameMs.p95)} frame p95. No game, browser, GPU, memory, asset, or network threshold fired.`;
  return localizePerfDiagnosis({ status, score, headline, summary, findings }, snapshot);
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function reportStatus(status: PerfDiagnosis['status']): string {
  if (status === 'critical') return t('hudChrome.perf.diagnostics.report.status.critical');
  if (status === 'needs-attention')
    return t('hudChrome.perf.diagnostics.report.status.needsAttention');
  return t('hudChrome.perf.diagnostics.report.status.healthy');
}

function reportSeverity(severity: PerfDiagnosisFinding['severity']): string {
  if (severity === 'critical') return t('hudChrome.perf.diagnostics.severity.critical');
  if (severity === 'warning') return t('hudChrome.perf.diagnostics.severity.warning');
  return t('hudChrome.perf.diagnostics.severity.info');
}

function reportConfidence(confidence: PerfDiagnosisFinding['confidence']): string {
  if (confidence === 'high') return t('hudChrome.perf.diagnostics.confidence.high');
  if (confidence === 'medium') return t('hudChrome.perf.diagnostics.confidence.medium');
  return t('hudChrome.perf.diagnostics.confidence.low');
}

function reportMilliseconds(value: number): string {
  return t('hudChrome.perf.units.ms', {
    value: formatNumber(value, { maximumFractionDigits: 1 }),
  });
}

/** A localized, copyable report intended for an issue, chat, or optimization session. */
export function formatPerfDiagnosisMarkdown(
  diagnosis: PerfDiagnosis,
  snapshot: PerfSnapshot,
  context: PerfDiagnosisReportContext = {},
): string {
  const renderer = snapshot.renderer;
  const capturedDate = context.capturedAt ? new Date(context.capturedAt) : null;
  const captured =
    capturedDate && Number.isFinite(capturedDate.getTime())
      ? formatDateTime(capturedDate, { dateStyle: 'medium', timeStyle: 'medium' })
      : context.capturedAt;
  const unavailable = t('hudChrome.perf.diagnostics.report.notAvailable');
  const lines = [
    `# ${t('hudChrome.perf.diagnostics.report.title')}`,
    '',
    t('hudChrome.perf.diagnostics.report.statusLine', {
      status: reportStatus(diagnosis.status),
      score: formatNumber(diagnosis.score, { maximumFractionDigits: 0 }),
    }),
    ...(captured
      ? [t('hudChrome.perf.diagnostics.report.capturedLine', { captured: oneLine(captured) })]
      : []),
    t('hudChrome.perf.diagnostics.report.topFindingLine', {
      finding: oneLine(diagnosis.headline),
    }),
    t('hudChrome.perf.diagnostics.report.summaryLine', { summary: diagnosis.summary }),
    t('hudChrome.perf.diagnostics.report.gpuLine', {
      gpu: oneLine(renderer?.glRenderer ?? unavailable),
    }),
    t('hudChrome.perf.diagnostics.report.graphicsLine', {
      tier: renderer?.tier ?? unavailable,
      scale: formatNumber(renderer?.effectiveRenderScale ?? 0, {
        maximumFractionDigits: 2,
      }),
    }),
    t('hudChrome.perf.diagnostics.report.recentLine', {
      fps: formatNumber(snapshot.windows.last10s.fps, { maximumFractionDigits: 1 }),
      p95: reportMilliseconds(snapshot.windows.last10s.frameMs.p95),
      longFrames: formatNumber(snapshot.windows.last10s.frameMs.long50, {
        maximumFractionDigits: 0,
      }),
      frames: formatNumber(snapshot.windows.last10s.frames, { maximumFractionDigits: 0 }),
    }),
    '',
  ];
  if (diagnosis.findings.length === 0) {
    lines.push(
      `## ${t('hudChrome.perf.diagnostics.report.resultHeading')}`,
      '',
      t('hudChrome.perf.diagnostics.report.noThreshold'),
      '',
    );
  }
  diagnosis.findings.forEach((finding, index) => {
    lines.push(
      `## ${t('hudChrome.perf.diagnostics.report.findingHeading', {
        index: formatNumber(index + 1, { maximumFractionDigits: 0 }),
        title: oneLine(finding.title),
      })}`,
      '',
      t('hudChrome.perf.diagnostics.report.findingMeta', {
        severity: reportSeverity(finding.severity),
        confidence: reportConfidence(finding.confidence),
      }),
      '',
      oneLine(finding.cause),
      '',
      `${t('hudChrome.perf.diagnostics.sections.evidence')}:`,
      ...finding.evidence.map((item) => `- ${oneLine(item)}`),
      '',
      `${t('hudChrome.perf.diagnostics.sections.tryNow')}:`,
      ...finding.immediateFixes.map((item) => `- ${oneLine(item)}`),
      '',
      `${t('hudChrome.perf.diagnostics.sections.codeFix')}:`,
      ...finding.codeFixes.map((item) => `- ${oneLine(item)}`),
      '',
      `${t('hudChrome.perf.diagnostics.sections.source')}:`,
      ...finding.sourceFiles.map((item) => `- ${oneLine(item)}`),
      '',
    );
  });
  lines.push(
    `## ${t('hudChrome.perf.diagnostics.report.rawSnapshotHeading')}`,
    '',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
    '',
  );
  return lines.join('\n');
}
