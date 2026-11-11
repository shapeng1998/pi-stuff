# Changelog

## [0.6.1] - 2026-11-11

- `web` and `codex-usage` share the Codex credentials lookup (`lib/codex.ts`) and call `https://chatgpt.com/backend-api` directly; a custom `openai-codex` base URL is no longer used.
- `web`: the call line is drawn by pi's `TruncatedText`, so a cut line ends in `...` instead of `…`.

## [0.6.0] - 2026-11-11

- New `codex-usage` extension: remaining Codex 5h and weekly limits right-aligned on the first footer line (`5h:77% 7d:39%`), refreshed at session start and after each run; below 20% a window turns yellow, below 5% red. `/codex-usage` refreshes and shows plan and reset times.
- `web`: moved from `extensions/web/index.ts` to `extensions/web.ts`, following pi's single-file style.

## [0.5.5] - 2026-11-10

- `web`: each call is shown as one Codex-style line (`Searched the web for …`, `Opened …`, `Searched for '…'`), cut to the terminal width; the result shows only its size or the error. Sources are no longer listed or stored in session details.

## [0.5.4] - 2026-11-09

- `web`: failed calls show the error message in the terminal instead of `0 sources`.
- `web`: account id extraction follows pi's own `extractAccountId`; `search()` takes the typed commands.

## [0.5.3] - 2026-11-09

- `web`: parameter schema written in plain TypeBox with pi's `StringEnum`; same parameters, ~400 bytes smaller.

## [0.5.2] - 2026-11-09

- `web`: fail with a clear error when the response has no `output` or the token has no ChatGPT account id, instead of continuing silently.
- Tooling: oxfmt (single quotes) and oxlint with type-aware rules and type checking replace `tsc`; `AGENTS.md` gains code conventions adapted from pi.

## [0.5.1] - 2026-11-08

- `web`: errors truncated to 1024 characters again, as documented in 0.3.0.
- README: list image search; drop the outdated note that github.com pages are refused (they open fine now).

## [0.5.0] - 2026-11-08

- Open source under MIT; Codex-derived parts of `web` credited in `THIRD_PARTY_NOTICES.md` (Apache-2.0).
- README rewritten for installing via `pi install git:github.com/shapeng1998/pi-stuff`.

## [0.4.1] - 2026-11-08

- `web`: send `originator: pi` (as pi's own openai-codex provider) instead of impersonating the Codex CLI.

## [0.4.0] - 2026-11-08

- `web`: mirror only the upstream API (schema and request); the rest is simplified (~255 → ~160 lines).
- `web`: stop sending conversation `input` (tested: search results are identical with or without it).
- `web`: always live; `PI_WEB_MODE` and `PI_WEB_MODEL` removed. Description inlined.
- Remove `scripts/codex-sync.sh` (upstream history links are in the file header), the `pi` manifest (conventional directories are auto-discovered) and empty skills/prompts/themes directories.

## [0.3.0] - 2026-11-08

- `web`: default mode is now `live` (real-time fetch, as Codex without a sandbox); set `PI_WEB_MODE=cached` for the old behavior.
- `web`: description cut to two lines (~45 tokens); parameter docs carry the rest.
- `web`: parameters carry upstream field descriptions; errors are truncated to 1024 bytes like Codex; 60s request timeout.
- `web`: code reorganized into blocks that each mirror one upstream Codex file, with a recorded baseline (`openai/codex@c9b4267c`).
- Add `scripts/codex-sync.sh` to list upstream changes since the baseline.

## [0.2.0] - 2026-11-07

- Rename `codex-web-run` to `web` (tool name `web`).
- Shorter tool description (~1.9k → ~0.4k tokens); same Codex commands and request.
- Env vars renamed to `PI_WEB_MODE` / `PI_WEB_MODEL`; fallback model now picked from available openai-codex models.

## [0.1.0] - 2026-11-07

- Initial package layout.
- Add `codex-web-run` extension (migrated from `~/.pi/agent/extensions/`).
