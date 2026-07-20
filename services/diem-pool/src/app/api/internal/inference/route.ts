import { NextRequest, NextResponse } from 'next/server';
import { requireInternalSecret } from '@/lib/auth';
import { inferenceRequestSchema } from '@/lib/schemas';
import { routeInference } from '@/lib/inference';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Long generations shouldn't hit the platform's default function timeout.
export const maxDuration = 300;

/**
 * Game backend → pool inference. Server-to-server only (shared secret).
 * Body: { payload: <OpenAI-style chat payload>, purpose, gameAccountId? }.
 * Response body is the upstream Venice response verbatim; routing metadata
 * rides in headers so callers stay OpenAI-compatible.
 */
export async function POST(req: NextRequest) {
  const denied = requireInternalSecret(req);
  if (denied) return denied;

  const parsed = inferenceRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const outcome = await routeInference(parsed.data);
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: {
      'x-pool-provider-id': outcome.providerId ?? '',
      'x-pool-vendor': outcome.vendor ?? '',
      'x-pool-house': String(outcome.house),
    },
  });
}
