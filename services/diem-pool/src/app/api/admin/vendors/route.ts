import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminToken } from '@/lib/auth';
import { vendorConfigUpdateSchema } from '@/lib/schemas';
import { ALL_VENDORS, DEFAULT_VENDOR_POLICIES } from '@/lib/vendors/config';
import { getVendorPolicies, invalidateVendorPolicyCache } from '@/lib/vendors/policies';
import { invalidatePoolCache } from '@/lib/inference';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Effective per-vendor policies (DB overrides overlaid on defaults). */
export async function GET(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  const policies = await getVendorPolicies();
  return NextResponse.json({
    vendors: ALL_VENDORS.map((vendor) => ({ vendor, ...policies[vendor] })),
  });
}

/**
 * Update one vendor's policy (per-vendor kill switch, reward multiplier,
 * standby eligibility, vesting window, trust ramp). Unspecified fields keep
 * their current effective value.
 */
export async function PUT(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  const parsed = vendorConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const { vendor, ...changes } = parsed.data;
  const current = (await getVendorPolicies())[vendor] ?? DEFAULT_VENDOR_POLICIES[vendor];
  const next = { ...current, ...changes };

  await prisma.vendorConfig.upsert({
    where: { vendor },
    create: { vendor, ...next },
    update: next,
  });
  invalidateVendorPolicyCache();
  invalidatePoolCache();
  return NextResponse.json({ vendor, ...next });
}
