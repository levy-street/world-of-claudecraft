// Client perf telemetry rows: the insert behind POST /api/perf-report and the
// nightly retention prune. Moved out of server/db.ts at the perf-report
// fidelity change (the monolith ratchet: db.ts pays for growth by extraction,
// server/CLAUDE.md module-first; server/character_lease_db.ts is the same
// split). The table's DDL lives in server/client_perf_reports_schema.ts, and
// the worst-10s concurrent index in server/client_perf_indexes.ts; this is
// the query half, unchanged in behavior by the move.
//
// db.ts keeps the exports so no caller re-points; the pool comes back from
// db.ts the way every other *_db.ts module takes it.

import { pool } from './db';

export interface ClientPerfReportInsert {
  schemaVersion: number;
  releaseVersion: string;
  buildId: string;
  sessionId: string;
  accountId: number | null;
  characterId: number | null;
  realm: string;
  graphicsPreset: string;
  gfxTier: string;
  autoGovernor: boolean;
  shaderWarmWorkerActive: boolean;
  shaderWarmRefusal: string;
  targetFps: number;
  renderScale: number;
  effectiveRenderScale: number;
  fpsAvg: number;
  frameP95Ms: number;
  frameP99Ms: number;
  longFrameCount: number;
  rendererCalls: number;
  rendererTriangles: number;
  rendererTextures: number;
  rendererPrograms: number;
  contextLostCount: number;
  longTaskCount: number;
  longTaskP95Ms: number;
  memoryUsedMb: number | null;
  memoryLimitMb: number | null;
  dpr: number;
  viewportBucket: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
  mobileTouch: boolean;
  desktopShell: boolean;
  browserFamily: string;
  osFamily: string;
  glVendor: string;
  glRendererBucket: string;
  glBackend: string;
  glRendererRaw: string;
  glModel: string;
  glLaptop: boolean | null;
  gpuHpAdapter: string;
  zoneOrScenario: string;
  source: string;
  crowdBucket: string;
  simEntities: number;
  activeViews: number;
  visibleViews: number;
  worst10sFrameP95Ms: number;
  suggestionIds: string[];
  rawSummary: Record<string, unknown>;
}

export async function insertClientPerfReport(row: ClientPerfReportInsert): Promise<void> {
  await pool.query(
    `INSERT INTO client_perf_reports (
       schema_version, release_version, build_id, session_id, account_id, character_id, realm,
       graphics_preset, gfx_tier, auto_governor, target_fps, render_scale, effective_render_scale,
       fps_avg, frame_p95_ms, frame_p99_ms, long_frame_count,
       renderer_calls, renderer_triangles, renderer_textures, renderer_programs, context_lost_count,
       long_task_count, long_task_p95_ms, memory_used_mb, memory_limit_mb,
       dpr, viewport_bucket, device_memory, hardware_concurrency, mobile_touch,
       browser_family, os_family, gl_vendor, gl_renderer_bucket, gl_backend, zone_or_scenario, source,
       crowd_bucket, sim_entities, active_views, visible_views, worst_10s_frame_p95_ms,
       suggestion_ids, raw_summary,
       gl_renderer_raw, gl_model, gl_laptop, gpu_hp_adapter,
       shader_warm_worker_active, shader_warm_refusal,
       desktop_shell
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20, $21, $22,
       $23, $24, $25, $26,
       $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
       $39, $40, $41, $42, $43,
       $44, $45, $46, $47, $48, $49, $50, $51,
       $52
     )`,
    [
      row.schemaVersion,
      row.releaseVersion,
      row.buildId,
      row.sessionId,
      row.accountId,
      row.characterId,
      row.realm,
      row.graphicsPreset,
      row.gfxTier,
      row.autoGovernor,
      row.targetFps,
      row.renderScale,
      row.effectiveRenderScale,
      row.fpsAvg,
      row.frameP95Ms,
      row.frameP99Ms,
      row.longFrameCount,
      row.rendererCalls,
      row.rendererTriangles,
      row.rendererTextures,
      row.rendererPrograms,
      row.contextLostCount,
      row.longTaskCount,
      row.longTaskP95Ms,
      row.memoryUsedMb,
      row.memoryLimitMb,
      row.dpr,
      row.viewportBucket,
      row.deviceMemory,
      row.hardwareConcurrency,
      row.mobileTouch,
      row.browserFamily,
      row.osFamily,
      row.glVendor,
      row.glRendererBucket,
      row.glBackend,
      row.zoneOrScenario,
      row.source,
      row.crowdBucket,
      row.simEntities,
      row.activeViews,
      row.visibleViews,
      row.worst10sFrameP95Ms,
      row.suggestionIds,
      JSON.stringify(row.rawSummary),
      row.glRendererRaw,
      row.glModel,
      row.glLaptop,
      row.gpuHpAdapter,
      row.shaderWarmWorkerActive,
      row.shaderWarmRefusal,
      row.desktopShell,
    ],
  );
}

// Keeps production telemetry bounded. PERF_REPORT_RETENTION_DAYS=0 disables
// pruning for a short manual capture window. One bounded batch per call: the
// caller (the retention sweep) drives iteration, so each DELETE is a short
// autocommit statement on the default statement timeout, riding
// client_perf_reports_created via the oldest-first ORDER BY.
export async function pruneClientPerfReportsBatch(
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM client_perf_reports
      WHERE id IN (
        SELECT id FROM client_perf_reports
         WHERE created_at < now() - ($1 || ' days')::interval
         ORDER BY created_at
         LIMIT $2)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
