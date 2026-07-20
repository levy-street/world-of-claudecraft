import { NextRequest, NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { killSwitchSchema } from '@/lib/schemas';
import { isRoutingPaused, setRoutingPaused } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  return NextResponse.json({ paused: await isRoutingPaused() });
}

/** Pool-wide kill switch: pauses all routing (inference returns 503). */
export async function POST(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  const parsed = killSwitchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  await setRoutingPaused(parsed.data.paused);
  return NextResponse.json({ paused: parsed.data.paused });
}
