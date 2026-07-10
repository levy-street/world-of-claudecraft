# Mobile Context Interact

## Context

Mobile players no longer need a separate Use button in the action ring. Jump now occupies the former hollow utility position and becomes contextual Interact when the player is close to an NPC, lootable corpse, lootable object, or delve interactable. A tap attempts the nearby interaction first and falls back to Jump when none is available. Attack remains a dedicated combat button.

NPC interaction also targets the NPC before opening its dialog, so the ground selection ring and target context match the conversation that opened.

## What We Learned

- The Attack acquire-nearest fallback needs shared attackability logic, not a narrow hostile flag. PvP opponents and Yumi objectives are valid attack targets even when they do not look like ordinary hostile mobs.
- Removing a static HUD control requires updating browser probes and layout audits as well as shell markup, styles, and unit tests.
- The existing press-first Jump binding keeps the contextual action responsive while the other thumb holds the movement joystick.
- Press-first click suppression must stay armed until pointer release; a timeout measured from pointerdown can repeat non-idempotent interactions after a long hold.
- Dynamic Jump/Interact copy must be painter-owned and explicitly invalidated on a language change. Static `data-i18n` ownership cannot know which action is active.
- Portrait web gameplay is reachable from `index.html`; the action ring needs its own portrait dock above the centered player frame.
- The full `npm run gate` remains the reliable final signal. Earlier isolated failures from an overloaded run passed when rerun directly and then passed again in the full gate.

## Decisions

- Keep `hud.core.mobileUse` in the localization catalog for now, but remove the static `#mobile-interact` shell markup.
- Route nearby interaction discovery through `src/game/interactions.ts` so keyboard interact and mobile contextual interact share priority and range behavior.
- Keep Attack dedicated to combat and let `#mobile-jump` own the contextual Interact state, icon, label, and accessible name.
- Keep dead-unreleased players on Jump. A released ghost gets contextual Interact only beside a Spirit Healer, where the action resurrects instead of opening gossip.
- Keep the branch as `mobile-layout-adjustments`, matching the requested layout-work name.

## Follow-ups

- Reference the committed before and after screenshots from `docs/screenshots` in the PR body.
- Push and open the PR only after the user confirms this prepared branch should be published.
