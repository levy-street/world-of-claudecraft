import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminToken } from '@/lib/auth';
import { pricingUpsertSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  const rows = await prisma.modelPricing.findMany({ orderBy: { model: 'asc' } });
  return NextResponse.json({
    pricing: rows.map((r) => ({
      model: r.model,
      inputUsdPerMTokens: Number(r.inputUsdPerMTokens),
      outputUsdPerMTokens: Number(r.outputUsdPerMTokens),
      active: r.active,
      updatedAt: r.updatedAt,
    })),
  });
}

/** Upsert one model's rates (admin pricing table editor). */
export async function PUT(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  const parsed = pricingUpsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const { model, inputUsdPerMTokens, outputUsdPerMTokens, active } = parsed.data;
  const row = await prisma.modelPricing.upsert({
    where: { model },
    create: { model, inputUsdPerMTokens, outputUsdPerMTokens, active },
    update: { inputUsdPerMTokens, outputUsdPerMTokens, active },
  });
  return NextResponse.json({ model: row.model, active: row.active });
}
