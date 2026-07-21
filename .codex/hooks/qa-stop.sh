#!/usr/bin/env bash
# Codex adapter for the shared instant copy gate. The Claude-owned script remains the
# implementation for its original file types. This adapter adds Codex-native TOML and
# TypeScript module extensions for tracked and untracked changes, then returns the same
# Stop-hook JSON contract.
set -uo pipefail

input=$(cat)
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
shared=$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="$root" bash "$root/.claude/hooks/qa-stop.sh")
if [ -n "$shared" ]; then
  printf '%s' "$shared"
  exit 0
fi

cd "$root" 2>/dev/null || exit 0
command -v perl >/dev/null 2>&1 || exit 0

stream=$(
  git diff -U0 --no-color -- '*.toml' '*.mts' '*.cts' 2>/dev/null
  git ls-files --others --exclude-standard 2>/dev/null \
    | grep -Ei '\.(toml|mts|cts)$' \
    | while IFS= read -r file; do
        [ -f "$file" ] || continue
        printf '+++ b/%s\n' "$file"
        sed 's/^/+/' "$file" 2>/dev/null
      done
)
[ -n "$stream" ] || exit 0

out=$(printf '%s' "$stream" | perl -CSD -e '
  my @hits; my $file = "";
  while (my $line = <STDIN>) {
    if ($line =~ m{^\+\+\+\s+b/(.+)$}) { $file = $1; $file =~ s/\s+$//; next; }
    next unless $line =~ /^\+/;
    next if $line =~ /^\+\+\+/;
    my $copy = substr($line, 1);
    chomp $copy;
    my $category = "";
    if ($copy =~ /[\x{2013}\x{2014}\x{2015}]/) {
      $category = "em or en dash";
    } elsif ($copy =~ /[\x{1F000}-\x{1FAFF}\x{1F1E6}-\x{1F1FF}\x{2600}-\x{27BF}\x{FE0F}]/) {
      $category = "emoji";
    } elsif (($file =~ /\.test\.(mts|cts)$/ || $file =~ m{(^|/)tests/})
             && $copy =~ /\b(?:it|test|describe|bench|suite)\.only\s*\(/) {
      $category = "stray .only( disables the suite";
    } elsif ($file =~ /\.(mts|cts)$/ && $copy =~ /^\s*debugger\s*;?\s*$/) {
      $category = "leftover debugger";
    }
    next unless $category;
    my $snippet = $copy;
    $snippet =~ s/^\s+//;
    $snippet =~ s/\s+$//;
    $snippet = substr($snippet, 0, 80);
    push @hits, "$file [$category]: $snippet";
    last if @hits >= 20;
  }
  exit 0 unless @hits;
  my $count = scalar @hits;
  my $body = "QA stop-gate blocked: $count newly added Codex line(s) violate a hard project invariant. Fix every listed line before finishing:";
  $body .= "\n- $_" for @hits;
  $body =~ s/([\\"])/\\$1/g;
  $body =~ s/([\x00-\x1f])/sprintf("\\u%04x", ord($1))/ge;
  print "{\"decision\":\"block\",\"reason\":\"$body\"}";
')

if [ -n "$out" ]; then
  printf '%s' "$out"
fi
exit 0
