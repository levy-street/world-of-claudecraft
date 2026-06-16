import type { LiveReportTarget } from './moderation_db';

export interface ReportTargetResolvers {
  reportTargetForPid(pid: number): LiveReportTarget | null;
  findCharacterReportTargetByName(name: string): Promise<LiveReportTarget | null>;
}

export type ResolveReportTargetResult =
  | { ok: true; target: LiveReportTarget }
  | { ok: false; status: number; error: string };

export async function resolveReportTarget(
  body: Record<string, unknown>,
  resolvers: ReportTargetResolvers,
): Promise<ResolveReportTargetResult> {
  // Only treat targetPid as a live-player id when the client actually sent a
  // finite number. Coercing first (Number(body.targetPid)) is unsafe: null,
  // '' and [] all coerce to a finite 0, which would hijack the name-lookup
  // path below and resolve a chat report against the non-existent pid 0.
  if (typeof body.targetPid === 'number' && Number.isFinite(body.targetPid)) {
    const target = resolvers.reportTargetForPid(body.targetPid);
    return target
      ? { ok: true, target }
      : { ok: false, status: 404, error: 'that player is no longer online' };
  }

  const name = typeof body.targetCharacterName === 'string' ? body.targetCharacterName.trim() : '';
  if (name) {
    const target = await resolvers.findCharacterReportTargetByName(name);
    return target
      ? { ok: true, target }
      : { ok: false, status: 404, error: 'that player could not be found' };
  }

  return { ok: false, status: 400, error: 'invalid report target' };
}
