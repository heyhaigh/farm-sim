# Propagate

See **[AGENTS.md](AGENTS.md)** — the conventions are there, kept in one file so Claude Code and Codex read the
same thing. In short: work in this repo (`~/ry-farms`), never in `~/ry-farms-deploy`; read
[COMPATIBILITY.md](COMPATIBILITY.md) before touching saves, terrain generation or the content tables; and run
`node tests/compat.mjs` (half a second) plus the rest of the suite before pushing.
