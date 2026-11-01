# Repeat Gravewyrm referral credit

## Original player report

`discord-player-report.png` is the original Discord report screenshot supplied by Matt, copied byte-for-byte from `Screenshot From 2026-11-01 16-03-31.png`. It shows Kyrie at 3/5 and the reported repeat clear with ZukaneWarriorA. It is player-supplied evidence, separate from our synthetic local reproductions; it does not establish personal quest turn-in state, deployed source version or boss eligibility.

## Local reproduction evidence

These captures render the actual stamp-card HUD using unchanged synthetic snapshots from local PostgreSQL tests of `ReferralGameServices` and `PgReferralStore`. They are not recordings of the reporter's account, the installed PC client, or a full 3D dungeon run. The boss defeat and quest turn-ins were exercised separately through the real simulation handlers.

The focused case has an already-stamped friend and a character missing the fourth stamp. Both assigned characters have turned in `q_gravewyrm`, regroup, and defeat a fresh claim-spawned Korzul. The card was started below level 5; Fogbinder's later permanent lock is a separate step.

- `before-repeat-desktop.png`: the missing character is at 3/5 before the qualifying repeat clear.
- `baseline-after-repeat-desktop.png`: unchanged `release/v0.46.0` remains at 3/5 after the clear. This is an independent synthetic baseline run, so its account names differ.
- `after-repeat-desktop.png`: the same character as the first image reaches 4/5 through the corrected boss-evidence path. The reward remains an explicit claim.
- `after-reload-desktop.png`: 4/5 is restored from PostgreSQL after fresh character and referral-service reconstruction.

All captures use the same 1440 by 1000 desktop viewport and Low preset. Enrollment/lock notices were acknowledged through the actual service command before capture. No screenshot edits or player data were used. The portable real-death/reducer regression is `tests/referral_dungeon_replay.test.ts`; the machine-specific database harness, capture tooling and raw snapshots remain outside the game checkout.

The additional `multiplayer-*` captures use the shipped `ClientWorld` and the real stamp-card HUD connected over actual WebSockets to the full local authoritative server and disposable PostgreSQL. A second synthetic character connects through a Node WebSocket client. This separate pair begins with both cards at 3/5 and both personal quests already turned in, unlike the asymmetric fixture above. These are browser-harness captures, not installed PC-client testing or a rendered 3D dungeon route.

- `multiplayer-before-repeat.png`: the active, locked card remains at 3/5 after login, with both characters' prior personal Gravewyrm quest completions persisted.
- `multiplayer-after-repeat.png`: a normal network attack defeats the real claim-spawned Korzul and the displayed card reaches 4/5.
- `multiplayer-after-reconnect-reload.png`: 4/5 remains after a real socket close/reconnect, followed by deliberate logout, lease release and a newly loaded character session from PostgreSQL.

The multiplayer capture uses Chromium 156 on Linux at the same desktop viewport. Local developer travel, invulnerability and one-shot damage shorten setup and combat; dungeon entry, targeting, facing, attack, boss death, referral processing and reconnect use the actual multiplayer handlers. The replay waits for Korzul to emerge before attacking. It does not assign stamp bits, send fabricated completion evidence or alter eligibility. Stored card revision and ready counters remain unchanged through reconnect. The fourth reward is subsequently claimed through the network command; retrying the claim leaves stored character/reward state unchanged. Both synthetic sessions release their leases afterward.

For characters that already turned in the quest, recovery requires another qualifying clear after the corrected server is deployed. A still-pending quest retains the ordinary qualifying turn-in path. Login and reopening the card do not backfill historical missing clear events. No account repair or backfill is included.
