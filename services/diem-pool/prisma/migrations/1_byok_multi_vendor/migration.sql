-- CreateEnum
CREATE TYPE "Vendor" AS ENUM ('venice', 'openai', 'anthropic', 'kimi');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('NEW', 'ESTABLISHED', 'TRUSTED');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('PENDING', 'VESTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ModelClass" AS ENUM ('fast', 'standard', 'smart');

-- DropIndex
DROP INDEX "Provider_wallet_key";

-- DropIndex
DROP INDEX "ModelPricing_model_key";

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "trustTier" "TrustTier" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "vendor" "Vendor" NOT NULL DEFAULT 'venice';

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "vendor" "Vendor" NOT NULL DEFAULT 'venice';

-- AlterTable
ALTER TABLE "ModelPricing" ADD COLUMN     "vendor" "Vendor" NOT NULL DEFAULT 'venice';

-- AlterTable
ALTER TABLE "RewardLedger" ADD COLUMN     "status" "RewardStatus" NOT NULL DEFAULT 'VESTED',
ADD COLUMN     "vestAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ModelClassMap" (
    "id" TEXT NOT NULL,
    "class" "ModelClass" NOT NULL,
    "vendor" "Vendor" NOT NULL,
    "model" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModelClassMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorConfig" (
    "vendor" "Vendor" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rewardMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "standbyEligible" BOOLEAN NOT NULL DEFAULT false,
    "vestingDays" INTEGER NOT NULL DEFAULT 7,
    "trustRampEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorConfig_pkey" PRIMARY KEY ("vendor")
);

-- CreateIndex
CREATE INDEX "ModelClassMap_class_active_idx" ON "ModelClassMap"("class", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ModelClassMap_class_vendor_model_key" ON "ModelClassMap"("class", "vendor", "model");

-- CreateIndex
CREATE INDEX "Provider_wallet_idx" ON "Provider"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_wallet_vendor_key" ON "Provider"("wallet", "vendor");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPricing_vendor_model_key" ON "ModelPricing"("vendor", "model");

-- CreateIndex
CREATE INDEX "RewardLedger_status_vestAt_idx" ON "RewardLedger"("status", "vestAt");


-- Backfill: existing providers get a tier consistent with their streak.
UPDATE "Provider" SET "trustTier" = CASE
  WHEN "consecutiveHealthyDays" >= 30 THEN 'TRUSTED'::"TrustTier"
  WHEN "consecutiveHealthyDays" >= 7 THEN 'ESTABLISHED'::"TrustTier"
  ELSE 'NEW'::"TrustTier" END;
