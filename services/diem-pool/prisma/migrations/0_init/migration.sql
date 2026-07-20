-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'REVOKED', 'INVALID');

-- CreateEnum
CREATE TYPE "UsagePurpose" AS ENUM ('npc_dialogue', 'quest_gen', 'dungeon_master', 'agent_player', 'image_gen');

-- CreateEnum
CREATE TYPE "NoncePurpose" AS ENUM ('register', 'revoke');

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "keyLast4" TEXT,
    "dailyCapacityUsd" DECIMAL(12,2) NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveHealthyDays" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "unhealthyToday" BOOLEAN NOT NULL DEFAULT false,
    "suspicionScore" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "lastProbeAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderNonce" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "purpose" "NoncePurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "purpose" "UsagePurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(14,8) NOT NULL,
    "gameAccountId" TEXT,
    "house" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDailySpend" (
    "providerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spentUsd" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProviderDailySpend_pkey" PRIMARY KEY ("providerId","date")
);

-- CreateTable
CREATE TABLE "ModelPricing" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputUsdPerMTokens" DECIMAL(12,6) NOT NULL,
    "outputUsdPerMTokens" DECIMAL(12,6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLedger" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "consumedUsd" DECIMAL(14,8) NOT NULL,
    "baseClaudium" INTEGER NOT NULL,
    "multiplier" DECIMAL(4,2) NOT NULL,
    "standbyClaudium" INTEGER NOT NULL,
    "capped" BOOLEAN NOT NULL,
    "totalClaudium" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRun" (
    "date" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "streaksApplied" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementRun_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_wallet_key" ON "Provider"("wallet");

-- CreateIndex
CREATE INDEX "Provider_status_idx" ON "Provider"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderNonce_nonce_key" ON "ProviderNonce"("nonce");

-- CreateIndex
CREATE INDEX "ProviderNonce_wallet_purpose_idx" ON "ProviderNonce"("wallet", "purpose");

-- CreateIndex
CREATE INDEX "UsageEvent_providerId_createdAt_idx" ON "UsageEvent"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderDailySpend_date_idx" ON "ProviderDailySpend"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPricing_model_key" ON "ModelPricing"("model");

-- CreateIndex
CREATE INDEX "RewardLedger_date_idx" ON "RewardLedger"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_providerId_date_key" ON "RewardLedger"("providerId", "date");

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderDailySpend" ADD CONSTRAINT "ProviderDailySpend_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

