# Changelog

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
