try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — rely on real environment variables */
}

import { PrismaClient, type ModelClass, type Vendor } from '@prisma/client';
import { SEED_CLASS_MAP, SEED_PRICING_BY_VENDOR } from '../src/lib/pricing';
import { ALL_VENDORS, DEFAULT_VENDOR_POLICIES } from '../src/lib/vendors/config';

// Seeds pricing, model-class mappings, and vendor policies. Re-runnable;
// existing rows keep any admin edits (create-only upserts).

const prisma = new PrismaClient();

async function main() {
  let pricingCount = 0;
  for (const [vendor, models] of Object.entries(SEED_PRICING_BY_VENDOR)) {
    for (const [model, rate] of Object.entries(models)) {
      await prisma.modelPricing.upsert({
        where: { vendor_model: { vendor: vendor as Vendor, model } },
        create: {
          vendor: vendor as Vendor,
          model,
          inputUsdPerMTokens: rate.inputUsdPerMTokens,
          outputUsdPerMTokens: rate.outputUsdPerMTokens,
        },
        update: {},
      });
      pricingCount++;
    }
  }

  for (const row of SEED_CLASS_MAP) {
    await prisma.modelClassMap.upsert({
      where: {
        class_vendor_model: {
          class: row.class as ModelClass,
          vendor: row.vendor as Vendor,
          model: row.model,
        },
      },
      create: {
        class: row.class as ModelClass,
        vendor: row.vendor as Vendor,
        model: row.model,
        priority: row.priority,
      },
      update: {},
    });
  }

  for (const vendor of ALL_VENDORS) {
    await prisma.vendorConfig.upsert({
      where: { vendor },
      create: { vendor, ...DEFAULT_VENDOR_POLICIES[vendor] },
      update: {},
    });
  }

  console.log(
    `seeded ${pricingCount} pricing rows, ${SEED_CLASS_MAP.length} class mappings, ${ALL_VENDORS.length} vendor policies`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
