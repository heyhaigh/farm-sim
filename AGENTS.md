# Working on Propagate

Read this first. It is short on purpose; each section points at the document that goes deep.

## 1. You are in the right repo

Work here — **`~/ry-farms`** (`github.com/heyhaigh/farm-sim`, public). This is where all development happens.

There is a **second** repo, **`~/ry-farms-deploy`** (`heyhaigh/farm-sim-deploy`, private). It is a **shipping
vehicle, not a workplace**: the same code plus the licensed art, and it only ever receives changes by merging
*from* here. Editing it directly forks the two trees and puts art in the path of ordinary commits.

The reason for the split is a licence, not a preference: the CraftPix licence permits shipping the art inside
a deployed game and forbids a public repo of the raw files. See **[HOSTING.md](HOSTING.md)**.

## 2. The rules that are not obvious from the code

**[COMPATIBILITY.md](COMPATIBILITY.md)** — read before changing anything that touches saves, terrain
generation, or the content tables. The game is live and players have towns in their own browsers that you can
never reach or fix. Several ordinary-looking edits silently rewrite or destroy those towns:

- bumping `SAVE_VERSION` without a migration step
- reordering `PROJECT_DEFS`, `HOUSE_TIERS`, `CRAFTABLES`, or renumbering the `T` tile enum
- changing a positional hash constant in `tilehash.js` or `farm.js`

There is a test that catches all of those. Run it.

**[TESTING.md](TESTING.md)** — how to run the game and the test suite, and what each file protects.
`node tests/compat.mjs` takes half a second and is the one that catches the save-breaking changes.

**[HOSTING.md](HOSTING.md)** — how the live site is built and deployed, and the one thing that bites: a new
sprite added here does **not** reach production on its own.

**Two domains, one game (2026-08-14).** Production answers on **`propagate.world`** (canonical) and
**`propagate.heyhaigh.ai`** (permanent fallback). Every change applies to BOTH — automatically, because one
Railway service serves both and `tools/ship.sh` refuses to report success unless both hosts answer the new
revision. The rules that keep it that way:

- **Never redirect the old host to the new one.** IndexedDB is origin-scoped; a redirect strands every town
  saved under the old origin. The fallback is a first-class play surface forever.
- **Never write host-conditional behavior** (`if (location.host === …)`) that makes the game differ between
  the two. The only host-aware constants are `LIVE_HOSTS` in analytics.js (lists BOTH) and `PUBLIC_ORIGIN`
  in postcard.js (the CANONICAL host — outbound links and OG tags brand the front door, never the host the
  player happens to be on; Codex #125 caught exactly this leak).
- A change that names a domain anywhere (markup, llms.txt, served docs) names the canonical one, with the
  fallback mentioned only as "also valid" where that helps.

**Search and answer-engine contract.** The game is canvas-first, so `index.html`, `robots.txt`,
`sitemap.xml`, and `llms.txt` are the durable explanation of what Propagate is. Keep their facts aligned
with the game rather than manufacturing keyword-led copy. The canonical entity is
`https://propagate.world/#game`, created by `https://heyhaigh.ai/#person`; the fallback host remains playable
but must not enter the sitemap or become canonical. Run `node tests/seo.mjs` after changing the entry page,
server routing, public description, creator identity, or crawler-facing files.

## 3. House conventions

- **No build step.** Pure ES modules, Canvas 2D, one WebGL post-process. Do not add a bundler.
- **The sim is deterministic.** Same seed ⇒ byte-identical town. The LLM and SuperMemory are display/
  persistence side-channels the simulation loop never reads. Keep it that way — `tests/determinism.mjs`
  pins four digests and a drift there is a real regression, not a re-baseline to wave through.
- **Serve it, don't open it.** `OPENAI_API_KEY= node server.mjs 8123`. A blank key keeps the LLM endpoints in
  fallback so nothing bills. `python3 -m http.server` serves **stale** modules — do not use it.
- **Junk seeds for testing** (424242, 515151, 20260101). The pinned seeds in `determinism.mjs` are baselines;
  do not casually re-pin them.
- **Reviews** are run through Codex against a directive: `CODEX_REVIEW_<n>_DIRECTIVE.md` in the repo root,
  gitignored so they never dirty the tree. Each carries a preamble requiring the reviewer to echo the HEAD sha
  and the pinned digests read from the files at HEAD — that exists because a stale report was once resurfaced
  against a newer tree, and the digests are what exposed it.
