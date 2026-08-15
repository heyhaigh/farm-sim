// version.js — the game's public version, drawn on the title screen beside the tagline.
//
// THE RULE (owner, 2026-08-13): every push to prod bumps the PATCH number, automatically —
// tools/ship.sh is the prod-push path and does the bump+commit itself, so a shipped build can
// never carry a stale number. Bump MINOR/MAJOR by running `tools/ship.sh minor|major` when an
// era changes (v2 began with the whisper/inspiration work). Do not hand-edit between ships.
export const VERSION = 'v2.0.12';
