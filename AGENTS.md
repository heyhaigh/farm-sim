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

**[TESTING.md](TESTING.md)** — how to run the game and the thirteen test files, and what each one protects.
`node tests/compat.mjs` takes half a second and is the one that catches the save-breaking changes.

**[HOSTING.md](HOSTING.md)** — how the live site is built and deployed, and the one thing that bites: a new
sprite added here does **not** reach production on its own.

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
