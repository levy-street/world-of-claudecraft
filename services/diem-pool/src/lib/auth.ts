import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualStr } from './crypto';
import { getEnv } from './env';

/** Game-backend → pool auth for /api/internal/*. */
export function requireInternalSecret(req: NextRequest): NextResponse | null {
  const header = req.headers.get('x-internal-secret') ?? '';
  if (!header || !timingSafeEqualStr(header, getEnv().INTERNAL_SHARED_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/** Admin token gate for /api/admin/* and the admin dashboard's API calls. */
export function requireAdminToken(req: NextRequest): NextResponse | null {
  const header = req.headers.get('x-admin-token') ?? '';
  if (!header || !timingSafeEqualStr(header, getEnv().ADMIN_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/** Best-effort client IP for rate limiting (trusts the platform's LB header). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
