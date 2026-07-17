# Ry Farms — LLM cost-safety + local-Ollama approach (review target)

Review the approach below for **money-leak risks** and **how to better incorporate a local model**. The
context: an OpenAI bill spiked from ~$0 to $27 (~$23 in one day) and we want to be sure it can't recur and
that the local setup is robust.

## The system
Ry Farms is a browser sim (static ES modules) served by a small Node http server (`server.mjs`) with a few
`/api/*` handlers. Four of them call an LLM through ONE chokepoint, `api/_llm.js`, which speaks the universal
Chat Completions API (`POST {OPENAI_BASE_URL}/chat/completions`):
- `api/ry-farms-chat.js` — rewrites two-line NPC conversation bubbles (called from the browser每 conversation)
- `api/ry-farms-dm.js` — the "chronicler" that writes each farmer's life story (called once per farmer at
  town founding, via `dm.js` `enrichStories`)
- `api/ry-farms-conscience.js` — reacts to a player's whisper (only on user interaction)
- `api/ry-farms-invent.js` — names a generatively-discovered recipe (via `memory-invent.js` `enrichInventions`)

Doctrine: all four are DISPLAY-ONLY. The sim is byte-identical with the LLM off (a presentation-only
boundary), and every caller has a procedural fallback. SuperMemory (a separate local store on :6767) uses its
own key and never touches OpenAI.

`api/_llm.js` config (env): `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`),
`RY_FARMS_LLM_MODEL` (default `gpt-4.1-mini`), and a new `RY_FARMS_LLM_OFF` kill switch.

## What went wrong (root cause)
1. The `.env` had `OPENAI_API_KEY` **set** but **no `OPENAI_BASE_URL`** — so it silently defaulted to paid
   `api.openai.com`. (The design intent was to point it at a local Ollama; that override was missing.)
2. The browser chat enables itself **unconditionally** whenever the game runs against the server
   (`#initLlmChat` returns `{enabled:true}` in a browser; it does not probe for a key or a local model).
3. Amplifiers: (a) each `?fresh=1` reload founds a NEW town and re-enriches ALL ~8-16 farmer lives + invention
   names (the `!story.llm` guard is defeated by fresh towns); (b) leaving the sim running fires a chat request
   every ~16 sim-seconds (faster on fast-forward). ~20 fresh reloads + long-running tabs over a day → ~4,600
   requests, ~66M input tokens on gpt-4.1-mini ≈ $26.

## The fixes we made
1. **`RY_FARMS_LLM_OFF=1` kill switch** in `_llm.js` — throws before any request, so every channel disables
   regardless of the key. Callers fall back to procedural; sim is byte-identical.
2. **Payload hard-cap**: the LLM `user` content sliced 24000 → 8000 chars (~2k tokens).
3. **Chat request cooldown** raised 16 → 45 sim-seconds; trimmed the town-log context in the chat payload.
4. **Accurate startup log**: reports `ON - LOCAL <url> - $0` when `OPENAI_BASE_URL` is a localhost address,
   `OFF` when the kill switch is set, else `ON - billing OpenAI`.
5. **Local model via Ollama**: installed Ollama (brew service), pulled `llama3.2:3b`, and set the `.env`:
   `OPENAI_BASE_URL=http://127.0.0.1:11434/v1` + `RY_FARMS_LLM_MODEL=llama3.2:3b`. Verified a real local
   completion through the game's chat endpoint (no OpenAI touched). The OpenAI key is now dormant.
6. User set a **$40 hard spend cap** on the OpenAI project (the alert is what caught this).

## Open questions for the review
1. **Is the single `_llm.js` chokepoint enough?** Are there any other paths (retries, cron, the SuperMemory
   writeback/graph, `knowledge-graph.js`, boot enrichment loops) that could hit a paid endpoint?
2. **The silent-default footgun**: `OPENAI_BASE_URL` unset → paid OpenAI. If `.env` is ever edited or the app
   is deployed (Vercel) without the base URL, it silently bills again. Should the DEFAULT be "off / local /
   fail-closed" rather than "paid OpenAI"? i.e. opt-IN to paid rather than opt-out.
3. **Local-model robustness**: what happens if Ollama is down / the model is missing / a request times out?
   (Callers fall back to scripted, but is there a failure mode that loops or degrades badly?) Is `llama3.2:3b`
   a reasonable choice for 2-line flavor text + short JSON, or should we pin something else / add a warm-up?
4. **Enrichment on every fresh town** re-runs all farmer-life + invention naming. Even local (free) that's
   wasted compute; on paid it was the spike. Should fresh-town enrichment be throttled / opt-in / cached
   across towns?
5. **Retry/cooldown correctness**: chat has a fail-cooldown (2 failures → 180s), `enrichStories`/
   `enrichInventions` have their own cooldowns. Are these enough to prevent a hot loop against a failing (or
   worse, a paid + erroring) endpoint?
6. **Anything else** that's a latent cost or reliability footgun in this design, and the cleanest way to make
   "free + local by default, paid only by explicit opt-in" the permanent posture.
