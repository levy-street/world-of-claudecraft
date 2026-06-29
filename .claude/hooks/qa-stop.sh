#!/usr/bin/env bash
# QA stop-gate for World of ClaudeCraft.
#
# Runs at the end of EVERY Claude Code turn (the Stop hook). It deliberately does only
# instant, near-zero-cost checks on the lines this turn ADDED, so it never slows the edit
# loop. It NEVER runs tsc, vitest, biome, or the LLM review:
#   - a Stop hook fires on every turn, so heavy checks here would tax every iteration;
#   - a hook is a shell command and cannot spawn the QA agent anyway.
# The heavier deterministic floor (tsc, guard tests, biome) runs once per push in
# .githooks/pre-push; the full multi-agent review is the /qa command and the qa-checklist
# agent.
#
# What it blocks on (all hard project invariants from CLAUDE.md, all detectable instantly):
#   - em dash, en dash, or emoji anywhere in code, comments, or docs;
#   - a stray ".only(" in a test, which silently disables the rest of that suite;
#   - a leftover "debugger" statement.
# On a hit it asks Claude to fix those exact lines before finishing. Otherwise it is silent.
#
# This script is checked in and runs on every contributor's machine. It is intentionally
# small, dependency-light (bash + git + perl, all already required to work on this repo),
# reads only `git diff`, writes nothing, and makes no network calls. See .claude/hooks/README.md.
set -uo pipefail

input=$(cat)

# Loop guard: if we already blocked once this turn, let Claude finish. Tolerant of spacing.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Added lines in this working tree, across source and docs, excluding locale overlays
# (native punctuation such as a real em dash is legitimate there) and generated bundles.
pathspec=(
  .
  ':(exclude)src/ui/i18n.locales'
  ':(exclude)src/ui/i18n.resolved.generated'
  ':(exclude)src/admin/i18n.resolved.generated'
  ':(exclude)*.lock'
  ':(exclude)package-lock.json'
)

# Tracked modifications (git diff) plus untracked, non-ignored files synthesized as
# all-added, so a brand-new file is scanned too. Untracked files are limited to text
# extensions to skip binaries.
stream=$(
  git diff -U0 --no-color -- "${pathspec[@]}" 2>/dev/null
  git ls-files --others --exclude-standard -- "${pathspec[@]}" 2>/dev/null \
    | grep -Ei '\.(ts|tsx|js|mjs|cjs|json|md|css|html|ya?ml|sh)$' \
    | while IFS= read -r f; do
        [ -f "$f" ] || continue
        printf '+++ b/%s\n' "$f"
        sed 's/^/+/' "$f" 2>/dev/null
      done
)
[ -n "$stream" ] || exit 0

out=$(printf '%s' "$stream" | perl -CSD -e '
  my @hits; my $file = "";
  while (my $line = <STDIN>) {
    if ($line =~ m{^\+\+\+\s+b/(.+)$}) { $file = $1; $file =~ s/\s+$//; next; }
    next unless $line =~ /^\+/;
    next if $line =~ /^\+\+\+/;
    my $c = substr($line, 1);
    chomp $c;
    my $cat = "";
    if ($c =~ /[\x{2013}\x{2014}\x{2015}]/) {
      $cat = "em or en dash";
    } elsif ($c =~ /[\x{1F000}-\x{1FAFF}\x{1F1E6}-\x{1F1FF}\x{2600}-\x{27BF}\x{FE0F}]/) {
      $cat = "emoji";
    } elsif (($file =~ /\.test\.(ts|tsx|js|mjs|cjs)$/ || $file =~ m{(^|/)tests/})
             && $c =~ /\b(?:it|test|describe|bench|suite)\.only\s*\(/) {
      $cat = "stray .only( disables the suite";
    } elsif ($file =~ /\.(ts|tsx|js|mjs|cjs)$/ && $c =~ /^\s*debugger\s*;?\s*$/) {
      $cat = "leftover debugger";
    }
    next unless $cat;
    my $snip = $c; $snip =~ s/^\s+//; $snip =~ s/\s+$//; $snip = substr($snip, 0, 80);
    push @hits, "$file [$cat]: $snip";
    last if @hits >= 20;
  }
  exit 0 unless @hits;
  my $n = scalar @hits;
  my $body = "QA stop-gate blocked: $n line(s) this change added violate a hard project invariant. "
    . "Fix every one before finishing (no em dashes, en dashes, or emojis anywhere; no stray .only() that "
    . "disables a test suite; no leftover debugger statement):";
  $body .= "\n- $_" for @hits;
  $body =~ s/([\\"])/\\$1/g;
  $body =~ s/([\x00-\x1f])/sprintf("\\u%04x", ord($1))/ge;
  print "{\"decision\":\"block\",\"reason\":\"$body\"}";
')

if [ -n "$out" ]; then
  printf '%s' "$out"
fi
exit 0
