# Propagate — the game server. Node built-ins only, so there is nothing to install and no build step.
#
# The COPY list below is an ALLOWLIST, and that is the whole point of using a Dockerfile here rather than
# letting a builder guess. This image must never contain .env (api keys) or .supermemory/ (auth-secret plus
# personal memory documents) — both sit in the project root, and an over-broad CLI deploy once put that pair
# on a public URL where `GET /.supermemory/api-key` answered 200. A committed, reviewable COPY list is a
# boundary that survives someone forgetting to update an ignore file. .dockerignore denies everything by
# default as the second layer, and server.mjs refuses dotfile paths as the third.
#
# SECRETS come from the host's environment variables (Railway's dashboard), never from a copied .env.
# server.mjs only reads .env for values NOT already in process.env, so real env vars win and no .env
# needs to ship.
#
# assets/ IS copied, and where it comes from is the whole trick. A public repo of raw CraftPix art is the
# one thing the licence forbids; shipping that art inside a deployed game is expressly allowed. So the art
# lives in a PRIVATE deploy repo (github.com/heyhaigh/farm-sim-deploy) that carries the same code plus
# assets/*.png, and Railway builds THAT. This public repo tracks only assets/.placeholder.png, so the COPY
# below is valid in both trees and the two Dockerfiles never diverge.
# Only .png is ever loaded (50 references, all .png), and the deploy repo carries only the 324 files a
# recorded boot proved the game requests (6.9MB) — not all 2034 PNGs (27MB), and none of the 146MB of
# .psd/.aseprite source art.
#
# ⚠️ SO: A NEW SPRITE ADDED HERE DOES NOT REACH THE DEPLOY. It must be copied into
# ~/ry-farms-deploy/assets and `git add -f`'d, or it 404s in production SILENTLY (every loader has an
# onerror fallback, so the art just quietly goes missing). See DEPLOY.md in the deploy repo.
# Without the art the game still runs on pixel.js's procedural sprites — but wilderness ROCKS have no
# fallback at all and render as nothing while staying impassable and still being the ore source, so an
# art-less deploy is a broken-looking world, not a plainer one.

FROM node:24-alpine

WORKDIR /app

# entry points, the title image, every game module, the server, and the api handlers
COPY index.html memory-graph.html propagate-title-anim2.png og-image.png llms.txt favicon.ico apple-touch-icon.png ./
COPY *.js ./
COPY server.mjs ./
COPY api/ ./api/
COPY assets/ ./assets/

ENV NODE_ENV=production

# Documentation only — Railway routes to whatever PORT it injects, and server.mjs prefers an explicit
# CLI arg, then process.env.PORT, then 8000.
EXPOSE 8000

# Drop root: this process only ever READS files off disk. If a volume-mounted asset 404s after a deploy,
# check the mount's permissions here first.
USER node

CMD ["node", "server.mjs"]
