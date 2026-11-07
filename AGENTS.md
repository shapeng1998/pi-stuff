# AGENTS.md

This repo is a personal pi package (see pi docs `packages.md`), loaded via `pi install ~/Projects/pi-stuff`.

## Layout

- `extensions/` — one extension per `*.ts` file, or `extensions/<name>/index.ts` for multi-file ones.
- `skills/<name>/SKILL.md` — agent skills, plus any helper scripts next to them.
- `prompts/*.md` — prompt templates (slash commands).
- `themes/*.json` — themes.
- `settings.example.json` — reference copy of personal `~/.pi/agent/settings.json` preferences. Sync by hand; never put `deviceId`, credentials or tokens here.

## Rules

- Host packages (`@earendil-works/pi-*`, `typebox`) go in `peerDependencies` with `"*"` only, never in `dependencies`. They are installed as `devDependencies` for type checking.
- Other runtime imports go in `dependencies`.
- Run `npm run check` after changing extensions; test in pi with `/reload`.
- For user-visible changes, bump `version` in `package.json` and add a `CHANGELOG.md` entry (`## [x.y.z] - YYYY-MM-DD`), so other machines see "Extension Updates".
- Add a one-line entry to `README.md` for every new extension, skill, prompt or theme.
