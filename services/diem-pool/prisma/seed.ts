try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — rely on real environment variables */
}

import { PrismaClient } from '@prisma/client';
import { SEED_PRICING } from '../src/lib/pricing';

// Seeds the admin-editable pricing table from Venice's published per-1M-token
// rates. Re-runnable; existing rows keep any admin edits (create-only).

const prisma = new PrismaClient();

async function main() {
  for (const [model, rate] of Object.entries(SEED_PRICING)) {
    await prisma.modelPricing.upsert({
      where: { model },
      create: {
        model,
        inputUsdPerMTokens: rate.inputUsdPerMTokens,
        outputUsdPerMTokens: rate.outputUsdPerMTokens,
      },
      update: {},
    });
  }
  console.log(`seeded ${Object.keys(SEED_PRICING).length} model pricing rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
