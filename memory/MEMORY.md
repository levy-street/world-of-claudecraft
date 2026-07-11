# Memory Index

- [Agent play setup](agent-play-setup.md) — drive WoC chars with agents: live realm URL, single-account multibox, driver scripts
- [Multibox accounts](multibox-accounts.md) — 5 dedicated ryze2–ryze6 box chars + shared password
- [Formatter hook reflows TS](formatter-hook-reflows-ts.md) — Edit/Write trigger a prettier hook that mangles whole .ts files; patch via Bash instead
- [Multibox staggered logout](multibox-staggered-logout.md) — "log out" = trickle bots out dps→healer→tank, random 20–60s gaps (anti-ban); SIGTERM self-staggers
- [Multibox party logs consolidated](multibox-party-logs-consolidated.md) — all parties → one shared party.md (single dashboard tab), tag-separated
- [PR workflow / release-v0.9](pr-workflow-release-v09.md) — base PRs off release/v0.9, push to fork remote, gh base-change REST workaround
- [Duo density ceiling](duo-density-ceiling.md) — psduo (tank+healer, no DPS) can't avoid deaths at dense L11 blob camps; the trio (with mage) clears them death-free at ~28k xp/h
- [Gravewyrm4 logout / ryzemage](multibox-gravewyrm4-logout-ryzemage.md) — ryzemage must be an authorized `logout` whisper sender for the gravewyrm4 fleet (control.from)
- [Gravewyrm4 combat doctrine](multibox-gravewyrm4-combat-doctrine.md) — packs: focus-fire + hunter pet off-tanks the loose add + hunter kites (Wing Clip/Concussive) so swifter doesn't die; needs a tamed pet [STALE: hunter swapped out for mage, see gravewyrm-farm]
- [Gravewyrm 5-man farm](gravewyrm-farm.md) — how the recurring Korzul-farm bot run is launched/monitored (supervisor), party comp (now mage not hunter), loot policy, login/ghost takeover gotchas
- [Attunement quest build](attunement-quest-build.md) — in-progress 3-bot Nythraxis attunement automation (attune mode): chain map, what works (quest 1 grind), open shard-distribution bug + stubbed quests 2-4
