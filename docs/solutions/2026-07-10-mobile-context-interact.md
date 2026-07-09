# Mobile Context Interact

## Context

Mobile players no longer need a separate Use button in the action ring. The primary Attack button now becomes contextual Interact when the player is close to an NPC, lootable corpse, lootable object, or delve interactable, as long as the player is not auto-attacking and does not already hold a live attack target. Jump now occupies the former hollow utility position in the ring.

NPC interaction also targets the NPC before opening its dialog, so the ground selection ring and target context match the conversation that opened.

## What We Learned

- Contextual mobile actions need to use shared attackability logic, not a narrow hostile flag. PvP opponents and Yumi objectives are valid attack targets even when they do not look like ordinary hostile mobs.
- Removing a static HUD control requires updating browser probes and layout audits as well as shell markup, styles, and unit tests.
- The touch tap helper already supports normal click dispatch, so browser scripts can exercise the contextual Attack path without adding test-only mobile event plumbing.
- The full `npm run gate` remains the reliable final signal. Earlier isolated failures from an overloaded run passed when rerun directly and then passed again in the full gate.

## Decisions

- Keep `hud.core.mobileUse` in the localization catalog for now, but remove the static `#mobile-interact` shell markup.
- Route nearby interaction discovery through `src/game/interactions.ts` so keyboard interact and mobile contextual interact share priority and range behavior.
- Use `isLiveAttackTarget` for the mobile Attack guard so contextual Interact never steals the button from combat against active PvP or scripted attackable targets.
- Keep the branch as `dev-td-mobile-context-interact`: the app workflow requires the `dev-td-` prefix, and the slug still names the actual change.

## Follow-ups

- Reference the committed before and after screenshots from `docs/screenshots` in the PR body.
- Push and open the PR only after the user confirms this prepared branch should be published.
