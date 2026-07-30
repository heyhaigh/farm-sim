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

```sh
# 1. work, commit and push in the public repo
cd ~/ry-farms && git push origin main

# 2. carry it into the deploy repo — this is the only thing that ships
cd ~/ry-farms-deploy
git fetch public && git merge public/main
git push origin main            # Railway builds on push
```

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
- **Variables:** `PORT=8080`, and **nothing else**. Specifically **no `OPENAI_API_KEY`** (keeps the LLM
  endpoints in fallback, so zero metered spend) and **never** the personal `SUPERMEMORY_URL` /
  `SUPERMEMORY_API_KEY`.
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

No `OPENAI_API_KEY` in production, so the LLM endpoints fall back and metered spend is zero. Determinism and
compile-don't-query must hold: the simulation never reads the LLM or SuperMemory in its loop.
