#!/usr/bin/env bash
# tools/ship.sh — THE prod-push path. Every push to prod bumps the version, automatically,
# because the bump lives inside the only sanctioned way to push (owner rule, 2026-08-13).
#
#   tools/ship.sh              bump PATCH (v2.0.3 -> v2.0.4), ship, poll until live
#   tools/ship.sh minor        bump MINOR (v2.0.9 -> v2.1.0), ship
#   tools/ship.sh major        bump MAJOR (v2.4.1 -> v3.0.0), ship
#   tools/ship.sh --dry-run    run every check + show the next version, ship NOTHING
#
# This is HOSTING.md's release flow verbatim (name the REV, ff main, assert it landed, merge into
# the deploy repo, assert ancestry, poll /api/build) with the version bump committed first — so a
# shipped build can never carry a stale number, and a stale-ref push can never ship silently.

set -euo pipefail
cd "$(dirname "$0")/.."

KIND="${1:-patch}"
DRY=""
[ "$KIND" = "--dry-run" ] && { DRY=1; KIND="patch"; }

# 0. a clean tree only — a ship must contain exactly what was reviewed
if [ -n "$(git status --porcelain -uno)" ]; then
    echo "REFUSED: working tree is dirty — commit or stash first:" >&2
    git status --porcelain -uno >&2
    exit 1
fi

# 0b. the half-second guard that catches save-breaking changes
node tests/compat.mjs > /dev/null || { echo 'REFUSED: tests/compat.mjs failed' >&2; exit 1; }

# 0c. the public discovery contract: canonical URL, metadata, entity graph, crawler files, and redirect
node tests/seo.mjs > /dev/null || { echo 'REFUSED: tests/seo.mjs failed' >&2; exit 1; }

# 1. bump the version (patch by default) in version.js
NEXT=$(SHIP_DRY="${DRY}" node -e "
const fs = require('fs');
const f = 'version.js';
const s = fs.readFileSync(f, 'utf8');
const m = s.match(/v(\d+)\.(\d+)\.(\d+)/);
if (!m) { console.error('version.js has no vX.Y.Z'); process.exit(1); }
let [, M, mi, p] = m.map(Number);
const kind = process.argv[1] || 'patch';
if (kind === 'major') { M++; mi = 0; p = 0; }
else if (kind === 'minor') { mi++; p = 0; }
else { p++; }
const v = 'v' + M + '.' + mi + '.' + p;
if (!process.env.SHIP_DRY) fs.writeFileSync(f, s.replace(/v\d+\.\d+\.\d+/, v));
console.log(v);
" "$KIND" 2>&1) || { echo "$NEXT" >&2; exit 1; }

if [ -n "$DRY" ]; then
    echo "dry run: next version would be $NEXT — nothing bumped, nothing shipped"
    exit 0
fi

git add version.js
git commit -q -m "$NEXT"
echo "version: $NEXT"

# 2. name what we are shipping, fast-forward main to it, push THAT ref explicitly
REV=$(git rev-parse HEAD)
git fetch -q origin
git checkout -q main
git merge -q --ff-only "$REV"
git push -q origin main
[ "$(git rev-parse origin/main)" = "$REV" ] || { echo "origin/main is NOT $REV — stop" >&2; exit 1; }
echo "public: $REV on origin/main"

# 3. carry it into the deploy repo — the only thing that ships
cd ../ry-farms-deploy
git fetch -q public
git checkout -q main
git merge -q --no-edit public/main
[ "$(git rev-parse public/main)" = "$REV" ] || { echo "public/main is NOT $REV — stop" >&2; exit 1; }
git merge-base --is-ancestor "$REV" HEAD || { echo "$REV is NOT in the deploy tree — stop" >&2; exit 1; }
DEPLOY_REV=$(git rev-parse HEAD)
git push -q origin main
echo "deploy: $DEPLOY_REV pushed — Railway is building"

# 4. assert it is actually LIVE on BOTH hosts (the image states its own revision; a poll past
# ~5min = failed build). One Railway service serves both, but the hostname bindings are separate
# edge state — a ship that leaves propagate.world dark must not report success (Codex #125).
for i in $(seq 1 40); do
    LIVE=$(curl -s --max-time 10 https://propagate.heyhaigh.ai/api/build | sed 's/.*"rev":"\([^"]*\)".*/\1/')
    LIVE_WORLD=$(curl -s --max-time 10 https://propagate.world/api/build | sed 's/.*"rev":"\([^"]*\)".*/\1/')
    if [ "$LIVE" = "$DEPLOY_REV" ] && [ "$LIVE_WORLD" = "$DEPLOY_REV" ]; then
        echo "LIVE on both hosts: $NEXT on $DEPLOY_REV ($((i * 15 - 15))s)"; exit 0
    fi
    sleep 15
done
echo "NEVER went live on both hosts (heyhaigh=$LIVE world=$LIVE_WORLD, want $DEPLOY_REV) — check Railway build logs / hostname bindings" >&2
exit 1
