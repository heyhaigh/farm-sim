# Hosting & deployment

The live game is **https://propagate.heyhaigh.ai**, served by Railway from a Docker image built out of a
private repo. This document is the whole picture: why there are two repos, how a change reaches production,
and the two traps that have already caught us.

## The shape

```
  ~/ry-farms                        ~/ry-farms-deploy
  github.com/heyhaigh/farm-sim  ──▶ github.com/heyhaigh/farm-sim-deploy   ──▶  Railway  ──▶  Cloudflare
  PUBLIC · code only                PRIVATE · code + art                        Docker        propagate.heyhaigh.ai
        (you work here)                  (merge target only)
```

**Why two.** The CraftPix licence permits shipping the art inside a deployed game and forbids a **public repo
of the raw files**. So the public repo carries no art — the only file under `assets/` is a 1×1
`.placeholder.png`, which exists purely so the Dockerfile's `COPY assets/` is valid in both trees and the two
Dockerfiles never diverge. The private repo carries the art and is what Railway builds.

## Deploying a change

> **The canonical path is `tools/ship.sh`** — it refuses a dirty tree, runs the compat guard,
> bumps the version (patch per push — the owner's rule; `minor`/`major` args for era changes),
> commits it, and then runs exactly the flow below with every assertion. `--dry-run` previews.
> The manual steps remain documented here as what the script does (and as the fallback).

> ### ⚠️ `git push origin main` does NOT push what you are working on
>
> It pushes the local **`main` ref**, whatever branch happens to be checked out. This has already cost a
> release: five reviewed commits sat on `topdown-buildings` while `main` and `public/main` stayed at
> `232d55f`, so the deploy repo faithfully shipped the old code and the live site was judged against fixes
> that were never running. Nothing failed loudly — the push "succeeded" and pushed nothing.
>
> **Always name the revision you intend to ship, and assert it landed.**

```sh
# 0. name what you are shipping
cd ~/ry-farms
REV=$(git rev-parse HEAD)          # the reviewed revision, on whatever branch you work on

# 1. fast-forward main to it, and push THAT ref explicitly
git fetch origin
git checkout main && git merge --ff-only "$REV"
git push origin main

# 2. assert before going further — a mismatch here means step 3 would ship the wrong tree
[ "$(git rev-parse origin/main)" = "$REV" ] || { echo "origin/main is NOT $REV — stop"; exit 1; }

# 3. carry it into the deploy repo — this is the only thing that ships.
#    Check main out EXPLICITLY: `git merge` merges into whatever is checked out, but the push below sends
#    the `main` ref. If the clone is ever left on another branch those are different commits, and the
#    procedure silently repeats the exact stale-ref failure it exists to prevent.
cd ~/ry-farms-deploy
git fetch public
git checkout main
git merge public/main
[ "$(git rev-parse public/main)" = "$REV" ] || { echo "public/main is NOT $REV — stop"; exit 1; }
git merge-base --is-ancestor "$REV" HEAD || { echo "$REV is NOT in the deploy tree — stop"; exit 1; }
DEPLOY_REV=$(git rev-parse HEAD)
git push origin main               # Railway builds on push

# 4. assert it is actually LIVE. The image STATES its own revision at /api/build, because a deploy can
#    succeed while Railway still serves an older one — we have hit that. Poll until it matches, or fail.
for i in $(seq 1 40); do
  LIVE=$(curl -s https://propagate.heyhaigh.ai/api/build | sed 's/.*"rev":"\([^"]*\)".*/\1/')
  [ "$LIVE" = "$DEPLOY_REV" ] && { echo "live on $LIVE"; break; }
  echo "  live=$LIVE want=$DEPLOY_REV — waiting"; sleep 15
done
[ "$LIVE" = "$DEPLOY_REV" ] || { echo "NEVER went live — check Railway"; exit 1; }
```

### Why `/api/build` rather than a byte count

The old check was `curl main.js | wc -c`. It printed a number and exited 0 whatever it found: it could not
fail, two revisions of equal size were indistinguishable, and it said nothing about `index.html` or the
mobile entry. `server.mjs` now answers `/api/build` with
`{"rev": RAILWAY_GIT_COMMIT_SHA || BUILD_REV || "unknown"}` — Railway injects the former on every build.

**If it answers `"unknown"`, the assertion is not working** and the deploy is unverified: set `BUILD_REV`
in the Railway service, or confirm `RAILWAY_GIT_COMMIT_SHA` is being injected. Do not treat a missing
revision as a pass.

Note `DEPLOY_REV` is the *deploy* repo's HEAD — a merge commit, so it is deliberately NOT equal to `REV`.
The `merge-base --is-ancestor` check on the line above is what ties the two together.

`--ff-only` is deliberate: if it refuses, `main` has commits your branch does not, and a silent merge commit
there is how the two repos drift apart in the first place.

Nothing to reconcile on that merge: the art is force-added past the deploy repo's own `.gitignore` rather
than by editing it, so **no tracked file differs** between the repos. The only difference is *which* files are
tracked.

`~/ry-farms-deploy`'s `public` remote fetches from the local path and its push URL is deliberately a bogus
string; the public GitHub remote is absent from that clone entirely. No push from there can publish the art.

## ⚠️ Trap 1 — a new sprite does not reach production on its own

The deploy repo carries a **curated subset** of the art: 324 files, 6.9MB, being what a recorded boot proved
the game actually requests. Not the 2034 PNGs on the workstation, and not the 146MB of `.psd`/`.aseprite`
sources, which nothing loads.

So a commit that references a **new** sprite needs that PNG copied across by hand:

```sh
cp ~/ry-farms/assets/<path>/<new>.png ~/ry-farms-deploy/assets/<path>/
cd ~/ry-farms-deploy && git add -f assets && git commit
```

Forget it and production 404s the file **silently** — every image loader has an `onerror` fallback, so nothing
throws and nothing logs. The art just quietly is not there. Wilderness rocks are the worst case: they have no
procedural fallback, so they render as nothing while remaining impassable and still being the ore source.

Three portraits are **derived, not copied** — `human-farmer`, `orc-raider`, `orc-raider-2` are 384×384
downscales of 1300×1300 masters (4.4MB → 592KB, and 4.4MB was two thirds of the entire boot payload). Do not
plain-copy those; re-derive:

```sh
for f in human-farmer orc-raider orc-raider-2; do
  magick ~/ry-farms/assets/$f.png -filter Lanczos -resize 384x384 -strip PNG32:assets/$f.png
done
```

To re-derive the whole curated list after art changes, see the recorded-boot method in the deploy repo's
`DEPLOY.md`.

## ⚠️ Trap 2 — purge Cloudflare after any art change

`propagate.heyhaigh.ai` is proxied through Cloudflare, and `server.mjs` sends `/assets/**` with
`public, max-age=2592000` (30 days). Asset filenames carry **no content hash**, so the edge cannot tell a new
sprite from the old one.

Seen live on the first art change: the deploy was correct — a cache-busted request returned the new
172,049-byte portrait — while every normal request got `cf-cache-status: HIT`, `age: 235`, and the old
1,429,096-byte file. **A correct deploy that looks broken.**

→ Cloudflare → Caching → Configuration → **Purge Everything**. Code and markup do not need it: they go out
`no-cache` and revalidate, which is why `main.js` shows `EXPIRED` rather than `HIT`.

If art starts changing often, the real fix is a content hash or `?v=` on asset URLs rather than remembering.

## Railway configuration

- **Source:** `heyhaigh/farm-sim-deploy`, branch `main`. Not the public repo — that produces art-less builds.
- **Variables:** `PORT=8080`, plus the FREE-TIER LLM set (2026-07-30, owner-approved): `OPENAI_BASE_URL=
  https://api.groq.com/openai/v1`, `OPENAI_API_KEY=gsk_…` (a Groq free-tier key), `RY_FARMS_LLM_MODEL=
  llama-3.1-8b-instant`, `RY_FARMS_ALLOW_PAID_LLM=1`. The flag's name is scarier than the reality: it means
  "remote endpoint permitted" — the Groq account holds **no payment card**, so billing is structurally
  impossible; the free quota (~14.4k req/day) just 429s when exhausted and every endpoint falls back to the
  offline keyword/template path. Kill switch: set `RY_FARMS_LLM_OFF=1`. **Never** the personal
  `SUPERMEMORY_URL` / `SUPERMEMORY_API_KEY`, and never a key from an account that has a card on file.
- **Free-quota fair share:** the player whisper endpoint has its own per-IP allowance of 120 requests
  per 10 minutes and 600/day (normally two requests per whisper: classify + reply). Automatic chat, DM,
  congregation, raids and inventions share a separate 40 per 10 minutes and 200/day. These are ceilings,
  not guaranteed provider capacity: `_llm.js` retains its existing global request/token budgets and breaker.
  Limits return 429 plus the actual remaining `Retry-After`; offline text keeps play responsive.
- **Groq conversation capacity (2026-09-22):** the exact Groq `/openai/v1` endpoint with
  `openai/gpt-oss-120b` / `openai/gpt-oss-20b` uses separate 7,000-token rolling-minute
  allowances (below the verified 8,000 TPM each). When one model lacks capacity, the next is
  tried without sending a doomed request. Together they allow up to 14,000 tokens/minute;
  automatic background work still stops at 3,000 total tokens and the global 26-attempt cap
  remains. An explicit `RY_FARMS_TOKEN_BUDGET` remains a global override; remove an old
  `5000` override to use the new default. Other providers/models keep the conservative default.
  Groq's organization/day quotas still apply; credit balance does not raise throughput limits.
- **HTTP boundary:** model JSON bodies are capped at 128 KiB (including chunked uploads), with a 10-second
  upload deadline and 4 in-flight requests per IP / 32 per process. Counters retain at most 10,000 IPs;
  a full non-expired table refuses new identities rather than evicting their daily limits. This is a
  single-instance safeguard; multiple replicas require a shared limiter. Players behind one NAT share
  these allowances; IPv6 address changes and distributed bots remain limitations of IP-based quotas.
- **Proxy identity:** on Railway (`RAILWAY_ENVIRONMENT_ID` present), use Railway's overwritten
  `X-Real-IP`, validated as an IP. Otherwise use the socket peer. Never trust raw caller
  `CF-Connecting-IP`/`X-Forwarded-For`. Railway documents that its edge derives this visitor IP from
  Cloudflare only for trusted Cloudflare connections:
  https://station.railway.com/questions/security-critical-questions-on-edge-prox-8fddd775
  Revisit this trust boundary before changing hosts or adding another proxy.
- **Local memory:** production disables all three developer-memory routes regardless of Origin or
  configured credentials. Reads return empty offline JSON; writes return 403. Development requires
  a loopback socket, loopback Host, and an absent/loopback Origin. Browser IndexedDB saves are unaffected.
- `server.mjs` reads `process.env.PORT`; an explicit CLI arg still wins, so `node server.mjs 8123` is
  unchanged locally. Set `PORT` explicitly rather than trusting a default to match the domain's target port —
  a mismatch is a 502 with a perfectly healthy container.
- The image is `node:24-alpine`, `USER node`, no build step, no npm install. The Dockerfile's `COPY` list is a
  committed, reviewable **allowlist** — that is the point of using one.

### DNS / TLS

`heyhaigh.ai` is on Cloudflare. The subdomain is a **record in that zone**, not a new site. Railway's
"Authorize DNS records from Railway" flow writes both records it needs — a **proxied** CNAME plus a
`_railway-verify.propagate` TXT — and proxied is fine *because* the TXT proves ownership. Zone SSL mode must
be **Full** (Flexible would redirect-loop).

Removing and re-adding a custom domain **mints a new CNAME target**, so any hand-written record instantly
points at a dead host. Re-check the target after every re-add.

## After a deploy, check

1. `GET /` loads the game.
2. `GET /api/knowledge-graph` returns **JSON, not 404**. A 404 means the api handlers did not make it into the
   image, and it is the one failure that is not loud: the game boots and plays fine on fallbacks while every
   endpoint is dead.
3. Art is present — if wilderness rocks or the orc biome are missing, the asset step was skipped.
4. Boot log says the LLM is off.

## Cost doctrine

The LLM runs on a cardless free tier (see Variables above), so metered spend is structurally zero. Determinism and
compile-don't-query must hold: the simulation never reads the LLM or SuperMemory in its loop.
