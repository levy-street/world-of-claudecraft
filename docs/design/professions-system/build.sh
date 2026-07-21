#!/bin/sh
# Generic single-file HTML doc builder. Copy this whole dir to start a new doc.
#
# Run from a source dir that contains:
#   _head.html      everything up to and including the content container open tag
#   manifest        ordered list of fragment filenames (under sections/), one per line; # comments allowed
#   sections/*.html the content fragments, in any name; order comes from the manifest
#   figures.js      (optional) JS inlined into a <script> after the content
# A "<!--TOC-->" marker anywhere in the fragments is replaced by a table of contents
# auto-generated from every <h1|h2|h3 id="..">Title</h> in document order (h1 entries
# render as part separators, h3 entries indented; headings without an id are skipped).
#
# Output: ../<this-dir-name>.html  (override with: sh build.sh path/to/out.html)
set -eu
src="$(cd "$(dirname "$0")" && pwd)"
cd "$src"
out="${1:-../$(basename "$src").html}"
body="$(mktemp)"; toc="$(mktemp)"
trap 'rm -f "$body" "$toc"' EXIT

# 1. concatenate fragments in manifest order
while IFS= read -r f || [ -n "$f" ]; do
  case "$f" in ''|\#*) continue ;; esac
  cat "sections/$f" >> "$body"; printf '\n' >> "$body"
done < manifest

# 2. table of contents from <h1|h2|h3 id="..">, in document order
# (id must be the first attribute; nested markup like <code> is stripped from the entry)
grep -oE '<h[123] id="[A-Za-z0-9_-]+"[^>]*>.*</h[123]>' "$body" \
  | sed -E 's@<(h[123]) id="([^"]+)"[^>]*>(.*)</h[123]>@\1|\2|\3@' \
  | sed -E 's@<[^>]*>@@g' \
  | sed -E -e 's@^h1\|([^|]+)\|(.*)@    <a class="t1" href="#\1">\2</a>@' \
           -e 's@^h2\|([^|]+)\|(.*)@    <a class="t2" href="#\1">\2</a>@' \
           -e 's@^h3\|([^|]+)\|(.*)@    <a class="t3" href="#\1">\2</a>@' > "$toc"

# 3. emit: head + body (TOC marker expanded) + optional inlined script + close
{
  cat _head.html
  awk -v tf="$toc" 'index($0,"<!--TOC-->"){while((getline l < tf)>0) print l; close(tf); next} {print}' "$body"
  printf '\n  </main>\n'
  if [ -f figures.js ]; then printf '\n<script>\n'; cat figures.js; printf '</script>\n'; fi
  printf '</body>\n</html>\n'
} > "$out"

echo "built $out ($(grep -c '' "$out") lines)"
