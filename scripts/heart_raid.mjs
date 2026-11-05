// The Smith's Heart fought by a real raid of bots over the local server: ten
// scripted players (two tanks, two healers, six damage dealers) log in through
// the real REST + world socket, form ONE raid group, level and gear to the
// raid's level with dev commands, take a fresh run of the Smith's Heart, walk
// to the chosen boss and fight it, playing its mechanics only from what the
// server sends. The run is written up as a fight log (scripts/lib/heart_raid_bots.mjs
// is the shared raid; scripts/lib/heart_raid_<boss>.mjs each boss's AI).
//
// DEV ONLY: needs the server on SERVER_URL (default http://localhost:8787)
// started with ALLOW_DEV_COMMANDS=1, which must never be set in production.
// Run with tsx (the boss modules reuse the sim's pure geometry):
//
//   BOSS=council DIFF=normal npx tsx scripts/heart_raid.mjs
//   BOSS=breath DIFF=mythic JOIN=Jose JOIN_ROLE=dps npx tsx scripts/heart_raid.mjs
//
// Environment:
//   BOSS        council | breath | quench | heat | final
//   DIFF        normal | heroic | mythic (the boss's dev tier switch)
//   JOIN        a character name: the raid leader invites it, the bots wait for
//               it at the boss and pull when it says "pull" in raid chat (or attacks)
//   JOIN_ROLE   dps | healer | tank: which bot steps out for the human
//   GEAR        kit (the fresh level-20 preset, default) | bis (top-parse)
//   MAX_SECONDS the fight's time limit (default 720)
//   LOG_DIR     where the fight logs go (default tmp/heart_raid)
//   POOL        every boss pool times this (0.65: the human-equivalent check)
//   IGNORE      the boss's key mechanic the raid ignores on purpose (see each module)
//   KICK_MISS   chance an assigned interrupter fumbles a kick (default 0.15)
//   SEED        the script's own rolls (default: the clock)
//   BOT_TAG     a second raid on the same server at once (its own accounts: hcbot_<key><tag>)
//   ORDER       council only: the kill order, guardian,singer or singer,guardian

import { runRaid } from './lib/heart_raid_bots.mjs';

const BOSS = (process.env.BOSS ?? 'council').toLowerCase();
const MODULES = {
  council: './lib/heart_raid_council.mjs',
  breath: './lib/heart_raid_breath.mjs',
  quench: './lib/heart_raid_quench.mjs',
  heat: './lib/heart_raid_heat.mjs',
  final: './lib/heart_raid_final.mjs',
};
if (!MODULES[BOSS]) throw new Error(`BOSS: ${BOSS} (one of ${Object.keys(MODULES).join(', ')})`);
const mod = await import(MODULES[BOSS]);
await runRaid(mod.default);
