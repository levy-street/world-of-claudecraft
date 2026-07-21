# World of ClaudeCraft - v0.8 Release Notes

**Release:** v0.8
**Date:** 2026-06-17
**Previous release:** v0.7.0

v0.8 is a focused release with **107 commits** since the public v0.7.0 release
tag. It expands Ashen Coliseum into ranked 2v2 play, adds a full wave of reactive
enemy mechanics, tightens anti-bot and authentication defenses, improves mobile
and Shaman play, and upgrades the public home/community surfaces.

## Highlights

- **Ranked 2v2 arena**: Ashen Coliseum now supports solo and premade 2v2 queueing,
  team matchmaking, shared Elo changes, team-aware targeting, and proper defeated
  states.
- **Reactive enemy affixes**: twelve new enemy mechanics make open-world combat
  more tactical, from Bristled Hide and Sticky Web to Mana Sear, Grave Mending,
  and Bog Bloat death explosions.
- **Anti-bot hardening**: Cloudflare Turnstile can gate login and registration,
  production auth can require real browser-origin requests, online play is capped
  to one character per account, and the server now tracks behavioral bot signals.
- **A better first screen**: the home page gains a cinematic trailer backdrop,
  redesigned play console, News & Updates feed, community wiki entry point, and
  official social links.
- **Mobile and input polish**: touch camera swipes, menu spacing, XP ring layout,
  hotbar state clearing, and Ghost Wolf movement/cancellation fixes make play
  smoother on phones and desktop.

## Arena & PvP

- **Ranked 2v2 added to Ashen Coliseum** (#502). Players can queue solo or as a
  two-player premade party, with matchmaking forming premade-vs-premade,
  premade-vs-solos, or solo-vs-solo teams as queue population allows.
- Arena HUD and server snapshots now carry match format, teammate and opponent
  combatants, bracket state, return timer, and queue size.
- Team Elo is applied consistently to both teammates, with wins and losses tracked
  per player.
- Arena deaths now use a real 0 HP defeated state instead of clamping players to
  1 HP. Defeated players cannot continue fighting or release spirit during the
  bout, and they are revived automatically when the match returns everyone to the
  world.
- Tab and nearest-enemy targeting now include arena opponents during countdown
  and active match flow.
- 2v2 queue, countdown, match-found, start, and result text is covered by the sim
  localization matcher.

## Enemy Combat & World Content

v0.8 continues the "living enemies" work from v0.7 with a broad set of deterministic
mob mechanics (#487 and source PRs #386, #389, #427, #431, #435, #442, #444,
#445, #446, #447, #448, #460):

- **Bristled Hide**: Wild Boars and Elder Bristlebacks reflect flat melee damage.
- **Silencing Shriek**: Gravecaller Summoners can silence spellcasters on hit.
- **Numbing Chill**: Stormcrag Elementals can slow movement.
- **Withering Wail**: Restless Bones can sap attack power.
- **Drowning Grasp**: Drowned Dead can heal from the damage they deal.
- **Bog Bloat / Caustic Spores**: volatile marsh creatures arm a short fuse on
  death, then burst in an area.
- **Mana Sear**: Wyrmcult Necromancers can burn mana from casters.
- **Sticky Web**: Webwood spiders can root players.
- **Miring Pounce**: Mire Prowlers can slow attack speed.
- **Wail of the Grave**: Gravecaller Summoners can fear victims.
- **Grave Mending**: Gravecaller Menders heal nearby wounded allies.
- **Maddening Whisper**: Wyrmcult Zealots can drain Intellect from mana users.

Other content updates:

- **The Codfather** fishing quest added in Fenbridge (#481), including a special
  quest-only catch in Deepfen Shallows, localized quest text, item data, icon
  support, and progression tests.
- Mob armor now scales from level 1 like HP and damage, removing an unintended
  extra level of armor from every mob (#180).
- Higher-level targets are now much harder to hit, reducing power-leveling against
  enemies far above the attacker (#443).
- Ranged auto-attacks now lose crit chance against higher-level targets the same
  way melee auto-attacks do (#209).

## Security, Moderation & Anti-Bot

- **Cloudflare Turnstile support** for login and registration (#462). When
  `TURNSTILE_SECRET` and `VITE_TURNSTILE_SITEKEY` are configured, auth requests
  require a valid Turnstile token and fail closed on verification errors.
- Docker and deployment config now pass Turnstile site keys and secrets through
  build/runtime environments.
- Production login/register can require a browser-origin request, with explicit
  `WEB_ORIGINS` and `REQUIRE_WEB_LOGIN` controls (#441).
- Online sessions are capped to **one active character per account**, with GM
  supervision exempted (#439).
- WebSocket sessions now have soft and hard per-IP bot pressure controls:
  high concurrent sessions contribute to the behavioral bot score, while extreme
  counts are rejected before joining the world (#486).
- **Behavioral bot detection Phase 1** added (#486): the server tracks action
  timing variance, reaction time, and concurrent-session evidence, then can
  auto-report, shadow-throttle, or kick sustained high-confidence sessions.
- Chat filtering now uses the admin hard list as the sole slur-enforcement trigger
  (#496), with admin account-detail mute/strike controls and a chat-moderated
  accounts list.

## UI, Mobile & Controls

- Mobile touch camera swipes added (#493).
- Release menu screens, XP spacing, XP ring layout, and in-game touch controls
  were polished across the v0.8 mobile pass (#488, #494, #498, #507).
- The mobile in-game community rail is now a single Community button, and the
  mobile More controls now open in a draggable modal with a close button (#507).
- The mobile Menu action inside More now opens the game menu directly, and the
  Attack / Autorun / Jump / Target / Use / Chat / More row stays stable while
  More opens and closes (#507).
- Mobile combat-row and spell-bar spacing were adjusted to prevent overlap (#507).
- Mobile hotbar hover state now clears after tapping, while retaining the short
  activated flash (#505).
- Hotbar focus is cleared after activation so pressing Space does not recast the
  last clicked ability (#505).
- Ghost Wolf no longer cancels from damage taken, passive retaliation, jumping,
  running, out-of-range attack attempts, or right-mouse camera drags over enemies
  (#505).
- Ghost Wolf backpedaling now uses reversed forward locomotion, while normal
  humanoid backpedal keeps its authored animation (#505).
- Cast bars now show a localized remaining-time countdown (#268).
- Rogue and Druid combo points now appear as pips over the target nameplate (#418).
- Green floating heal numbers now appear over any healed entity, not only the
  local player, making enemy lifesteal and support heals readable (#435 / #487).

## Rendering & Presentation

- Ambient leaping fish now break the surface of open water (#424). The effect is
  render-only, deterministic, and samples the same terrain and water data as the
  simulation.
- Brother Aldric's pre-v0.7 classic character model was restored (#499).
- The home page now has a cinematic trailer backdrop, redesigned play console,
  public trailer media, and main-theme audio assets.
- Home-screen music behavior was quieted so the shell does not unexpectedly play
  over the first screen.

## Home, Community & Web

- The landing page now includes a copy widget for the `$WOC` contract address
  (#437) plus a community-token note.
- A public **News & Updates** view now reads published GitHub Releases through a
  cached server proxy instead of calling GitHub directly from each browser.
- The community wiki is surfaced from the home page.
- A fully localized official-channels page is available at `/links`, with aliases
  at `/social` and `/social-media-links` (#453). It includes the Play CTA, X,
  Instagram, TikTok, YouTube, Reddit, and GitHub links, with accessibility,
  mobile, SEO, and JSON-LD checks.

## Contributor & Project Docs

- Added `CONTRIBUTING.md` plus translated contributor guides in `docs/i18n/`
  (#398).
- Added pull request and issue templates, a code of conduct, and a security policy
  (#398).
- Moved localized README and CONTRIBUTING files under `docs/i18n/` to keep the
  repository root focused (#398).
- Renamed i18n internals from development-phase names to content-based names
  (`classAbility`, `item`, `world`) without changing translation data or behavior
  (#464).
- Added detailed behavioral bot detection design docs (#486).

## Fixes & Quality

- Private realm join/leave notices no longer broadcast every player entry and
  departure to the whole realm.
- Pet feeding is now toggleable from the HUD/server path.
- The teleport interpolation-anchor regression is now locked by tests (#199).
- The generated media manifest now includes v0.8 public media assets.
- Expanded regression coverage across arena, anti-bot, Turnstile, web login
  origin checks, mobile controls, nameplate combo points, fish rendering helpers,
  and each new mob affix.

## Upgrade Notes

- `package.json` is now `0.8.0`.
- To enable Turnstile in an environment, configure both:
  - `TURNSTILE_SECRET` on the server at runtime.
  - `VITE_TURNSTILE_SITEKEY` at client build time.
- If production auth-origin enforcement is enabled behind a proxy, verify that
  the proxy preserves `Origin`, `Host`, or `X-Forwarded-Host`, or configure
  `WEB_ORIGINS` explicitly.
- The new `/api/releases` endpoint reads public GitHub Releases and may use
  `GITHUB_TOKEN` server-side to raise GitHub API rate limits.

## Validation

- `npm run test` - 1383 passed across 140 files.
- `npm run build` - completed successfully.
- `node scripts/links_verify.mjs` - all checks passed, including desktop/mobile
  overflow and tap-target checks.

*Generated from the public `v0.7.0..release/v0.8` release range. PR numbers
reference merged pull requests and source PRs preserved through release-batch
merges.*
