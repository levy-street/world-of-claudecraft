import { prisma } from '../db';
import {
  ALL_VENDORS,
  DEFAULT_VENDOR_POLICIES,
  type VendorName,
  type VendorPolicy,
} from './config';

// VendorConfig DB rows overlaid on the in-code defaults, cached briefly.
// The admin vendors API writes rows and invalidates this cache; other
// instances converge within the TTL.

const POLICY_CACHE_MS = 5_000;

const globalState = globalThis as unknown as {
  vendorPolicyCache?: { at: number; policies: Record<VendorName, VendorPolicy> } | null;
};

export async function getVendorPolicies(): Promise<Record<VendorName, VendorPolicy>> {
  const cached = globalState.vendorPolicyCache;
  if (cached && Date.now() - cached.at < POLICY_CACHE_MS) return cached.policies;

  const rows = await prisma.vendorConfig.findMany();
  const byVendor = new Map(rows.map((r) => [r.vendor as VendorName, r]));
  const policies = Object.fromEntries(
    ALL_VENDORS.map((vendor) => {
      const row = byVendor.get(vendor);
      const policy: VendorPolicy = row
        ? {
            enabled: row.enabled,
            rewardMultiplier: Number(row.rewardMultiplier),
            standbyEligible: row.standbyEligible,
            vestingDays: row.vestingDays,
            trustRampEnabled: row.trustRampEnabled,
          }
        : DEFAULT_VENDOR_POLICIES[vendor];
      return [vendor, policy];
    }),
  ) as Record<VendorName, VendorPolicy>;

  globalState.vendorPolicyCache = { at: Date.now(), policies };
  return policies;
}

export function invalidateVendorPolicyCache(): void {
  globalState.vendorPolicyCache = null;
}
