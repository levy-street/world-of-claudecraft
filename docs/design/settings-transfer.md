# Settings and hotkey transfer codes

The options window exports and imports player preferences as pasted text codes.
There is no file round-trip: a code is a JSON envelope the player copies from a
read-only box and pastes into another client. Two envelope families exist, and
both are validated against an explicit allowlist before anything is written.

Owning modules: `src/ui/settings_transfer_core.ts` (pure envelope + allowlist),
`src/ui/settings_transfer.ts` (the localStorage half), `src/ui/keybind_transfer_core.ts`
(the hotkey envelope), `Keybinds.snapshot` / `Keybinds.importBindings` in
`src/game/keybinds.ts` (the hotkey model half), and the rows in
`src/ui/options_window.ts` (`transferControls`, `transferRows`, `keybindTransferRows`,
`renderTransfer`). Pinned by `tests/settings_transfer_core.test.ts`,
`tests/keybind_transfer_core.test.ts` and `tests/keybinds.test.ts`.

## The two envelopes

| Marker (`woc`) | Version (`v`) | Payload | Written by |
|---|---|---|---|
| `woc-transfer` | `1` | `kind` + `data`: raw localStorage key/value strings | `settings_transfer.ts` (page reload applies) |
| `woc-keybinds` | `1` | `binds`: actionId -> `[primary, secondary]` combos | `Keybinds.importBindings` (applies live) |

The markers are distinct so a code of one family pasted into the other family's
box is reported as the wrong kind, never as generic garbage. Each parser also
reports `format` (not a code, or over the size bound) and `empty` (a valid
envelope carrying nothing this build accepts), so the UI can say which.

## Version policy

`v` is a number and is currently `1` for both families. A parser accepts any
numeric `v`: unknown keys and unknown action ids are DROPPED, not errors, so a
code written by a newer build imports the parts an older build understands.
Bump `v` only when the payload SHAPE changes in a way an older parser would
misread (for example, a combo string that is no longer a `KeyboardEvent.code`).
When that happens, keep parsing `v: 1` and translate, or refuse it with a new
reason the UI names; never let a stale shape reach storage silently.

## The kind ladder (`woc-transfer`)

`kind` is one of three tiers, each a strict superset of the one before:

1. `frames`: the frame geometry families (movable frames, chat geometry, meter
   panels, the target-aura panel, the warlock doom meter) and their hidden flags.
2. `settings`: the above plus the settings object, the theme, the legacy
   account-wide keybind seed and the panel preferences.
3. `full`: the above plus every remaining player-facing preference family on the
   device: per-character key binding profiles, gamepad and cross hotbar binds,
   aura overlay configs, window filters, roster prefs, language, the perf overlay
   config, the layout-reset epoch, dismissed hints, and the keyboard overview's
   size and legend choices.

A code of a WIDER kind fills a NARROWER box (a `full` code pasted into the
frames box writes only the frame families); a narrower code never fills a wider
box (reported as `kind`). The rank check uses own keys only, so a prototype name
such as `constructor` is not a kind.

## The allowlist boundary

An import writes localStorage, so the allowlist is the security boundary. It is
exact keys plus a few narrow prefixes (`woc_hud_frame_`, `woc_keybinds:`,
`woc_gamepad_xhb:`, `woc_aura_overlays:`, `woc_emote_wheel_`, `woc_deed_watch_`,
`woc_reliquary_pins_`, `woc_spawn_intro_seen:`, `woc_target_auras_`,
`woc_chat_`). `woc_` on its own is never a prefix. Identity, session, wallet,
purchase, attribution and cache keys are excluded, and so is the chat ignore list
(`woc_ignored_chat_names`), because it names other players and a shared "here is
my setup" code must not carry it. Action bar layouts (`woc_hotbar_*`) stay out
too: the server owns them per character and would overwrite an import at login.

The test file pins the boundary three ways: a hand-picked hostile list, every
FULL-tier literal (so dropping one silently orphans nothing), and a sweep over
every `woc*` string literal under `src/` that fails the moment a new key is
admitted through a prefix without being added to the expected list.

## Bounds and atomicity

A pasted code is refused when it exceeds `TRANSFER_CODE_MAX_CHARS` in total,
when any value exceeds `TRANSFER_VALUE_MAX_CHARS`, or when it carries more than
`TRANSFER_MAX_ENTRIES` keys, so an import can never fill the origin's storage
quota (which would silently break every later save, the session's included).
The write is all or nothing: a `setItem` that throws part-way puts every key
already written back to its previous value.

## Hotkey codes

`Keybinds.importBindings` runs the same validation a stored profile gets on
load: unknown actions are ignored, reserved codes (Escape, the camera mouse
buttons) are refused, one code drives one action (first writer keeps it),
missing actions keep their defaults, and every combo is re-spelled through the
canonical `makeCombo` order (`Ctrl`, `Alt`, `Shift`, `Meta`) with repeated or bare
modifiers and non-code strings dropped. Held (movement) actions store the bare
key, as `bind()` does. The panel hands `parseKeybindCode` the registry's action
ids, so a code naming none of them is refused as hollow rather than importing as
a full reset.
