// The Hammer Council fought by ten bots over the local dev server: kept as the
// council's own entry point; the raid lives in scripts/heart_raid.mjs (BOSS=council)
// and the council's AI in scripts/lib/heart_raid_council.mjs. DEV ONLY (the server
// needs ALLOW_DEV_COMMANDS=1, never in production).
//
//   DIFF=heroic ORDER=singer,guardian npx tsx scripts/heart_council_raid.mjs

process.env.BOSS = 'council';
await import('./heart_raid.mjs');
