# AGENTS.md

This repo is a personal pi package (see pi docs `packages.md`), loaded via `pi install ~/Projects/pi-stuff`.

## Layout

Conventional directories, auto-discovered by pi (no `pi` manifest); create one when first needed:

- `extensions/` — one extension per `*.ts` file, or `extensions/<name>/index.ts` for multi-file ones.
- `lib/*.ts` — modules shared by extensions; not auto-discovered.
- `skills/<name>/SKILL.md` — agent skills, plus any helper scripts next to them.
- `prompts/*.md` — prompt templates (slash commands).
- `themes/*.json` — themes.

## Rules

- Host packages (`@earendil-works/pi-*`, `typebox`) go in `peerDependencies` with `"*"` only, never in `dependencies`. They are installed as `devDependencies` for type checking.
- Other runtime imports go in `dependencies`.
- After changing extensions, run `pnpm fmt` and `pnpm check` (oxfmt, then oxlint with type-aware rules and type checking); test in pi with `/reload`.
- For user-visible changes, bump `version` in `package.json` and add a `CHANGELOG.md` entry (`## [x.y.z] - YYYY-MM-DD`), so other machines see "Extension Updates".
- Add a short `README.md` section for every new extension, skill, prompt or theme. Credit derived third-party code in `THIRD_PARTY_NOTICES.md`.

## Code

Adapted from pi's `AGENTS.md` and `docs/extensions.md`; pi's `examples/extensions/` are the reference for extension APIs.

- No `any` unless unavoidable. Look up external API types in `node_modules`; don't guess.
- Validate only at trust boundaries (HTTP responses, tokens, JSON files): give the data a type with optional fields, cast once where it is parsed, and check the values you use. No runtime checks of values TypeScript already guarantees.
- Keep tool output bounded (pi's limit is 50KB / 2000 lines); report failures by throwing.
- Comments explain why, not what. Inline single-line helpers that have one call site.
- Ask before removing functionality that looks intentional. Don't keep code for backward compatibility unless asked.
