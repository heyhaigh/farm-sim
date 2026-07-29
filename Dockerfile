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
# assets/ is deliberately NOT copied. The CraftPix sprites are gitignored, because a public repo of raw
# art is the one thing that licence forbids — so a git-based build has no art. Mount them at /app/assets
# with a Railway volume. Without them the game falls back to the procedural pixel.js sprites and still
# runs; the wilderness rocks and the orc biome are the parts that go missing.

FROM node:24-alpine

WORKDIR /app

# entry points, the title image, every game module, the server, and the api handlers
COPY index.html memory-graph.html propagate-title-anim2.png ./
COPY *.js ./
COPY server.mjs ./
COPY api/ ./api/

ENV NODE_ENV=production

# Documentation only — Railway routes to whatever PORT it injects, and server.mjs prefers an explicit
# CLI arg, then process.env.PORT, then 8000.
EXPOSE 8000

# Drop root: this process only ever READS files off disk. If a volume-mounted asset 404s after a deploy,
# check the mount's permissions here first.
USER node

CMD ["node", "server.mjs"]
