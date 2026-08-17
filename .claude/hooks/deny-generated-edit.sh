#!/usr/bin/env bash
# PreToolUse guard for World of ClaudeCraft: block direct Edit/Write calls to generated
# artifacts (a hard invariant from the root CLAUDE.md: never hand-edit generated files,
# regenerate via the owning build step).
#
# Scope is deliberately narrow and unambiguous: *.generated.ts anywhere, and anything
# under an i18n.resolved.generated/ directory. Regenerators are unaffected: they write
# through node/npm build scripts (Bash), which this hook never sees. Everything else
# (SFX manifests, media manifests) stays prose-guarded: their paths are less uniform and
# a false block on every turn would cost more than it saves.
#
# Like the other checked-in hooks this is small and auditable: bash only, reads stdin,
# writes nothing, no network. It fails OPEN (exit 0) on anything unexpected, because a
# broken guard must never wedge the edit loop. See .claude/hooks/README.md.
set -uo pipefail

input=$(cat)

# Extract the target path from the tool input JSON without requiring jq: match the
# "file_path" key. A hook that cannot parse its input lets the call through.
path=$(printf '%s' "$input" | perl -0777 -ne 'print $1 if /"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/' 2>/dev/null || true)
[ -n "$path" ] || exit 0

case "$path" in
  *.generated.ts|*/i18n.resolved.generated/*)
    echo "Blocked: $path is a generated artifact. Never hand-edit generated files; change the owning source (catalog, overlay, map) and regenerate via the owning build step (npm run build chains them; see the root CLAUDE.md invariant)." >&2
    exit 2
    ;;
esac
exit 0
