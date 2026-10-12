#!/usr/bin/env bash
# Measures type-checking cost for the scope call forms spike.
#
# Usage: scope-call-forms-measure.sh <label> <nouse|uses> <out-dir>
#
# Run from the repository root after `pnpm build`. Each target is checked twice with
# `pnpm typecheck --extendedDiagnostics`.
#
# nouse: every scope test and probe is moved aside, so nothing calls a scope. The
#        package keeps test/scopes-fixture.ts, which registers the two test scope kinds.
#        The demo keeps the Postgres facade's registration, which every user has.
# uses:  only the ten-use probes stay: test/scopes-uses.types.test-d.ts in the package
#        and in the demo. test/scopes-orm-fixture.ts is moved aside in both modes.
set -euo pipefail

label="$1"
mode="$2"
out="$3"
mkdir -p "$out"

pkg=packages/3-extensions/sql-orm-client
demo=examples/prisma-8-demo
hidden=()

hide() {
  local file="$1"
  mv "$file" "$file.hidden"
  hidden+=("$file")
}

restore() {
  for file in "${hidden[@]+"${hidden[@]}"}"; do
    mv "$file.hidden" "$file"
  done
}
trap restore EXIT

for file in "$pkg"/test/scopes-orm-fixture.ts "$pkg"/test/scopes*.test.ts "$pkg"/test/scopes*.test-d.ts "$demo"/test/scopes*.test-d.ts; do
  [ -e "$file" ] || continue
  if [ "$mode" = uses ] && [ "$(basename "$file")" = scopes-uses.types.test-d.ts ]; then
    continue
  fi
  hide "$file"
done

for target in "$pkg" "$demo"; do
  name=$(basename "$target")
  for run in 1 2; do
    log="$out/$label-$mode-$name-$run.log"
    (cd "$target" && mise exec -- pnpm typecheck --extendedDiagnostics >"$OLDPWD/$log" 2>&1) || true
    printf '%s %s %s run %s: ' "$label" "$mode" "$name" "$run"
    grep -E '^(Instantiations|Types|Check time|Total time|Memory used):' "$log" | tr -s ' ' | paste -sd ' ' -
    grep -E 'error TS' "$log" | head -5 || true
  done
done
