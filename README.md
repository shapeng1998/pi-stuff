# pi-stuff

Personal [pi](https://pi.dev) package: extensions, skills, prompts and themes, synced across machines with git.

## Setup on a machine

```sh
git clone https://github.com/shapeng1998/pi-stuff.git ~/Projects/pi-stuff
pi install ~/Projects/pi-stuff
```

pi loads the package from this directory in place, so `git pull` followed by `/reload` (or restarting pi) picks up changes.

## Workflow

- Edit, `pnpm check`, then `/reload` in pi.
- Use `pi config` to toggle individual resources per machine.
- Bump `version` and update `CHANGELOG.md` for notable changes.

## Extensions

- [`web`](extensions/web) — Codex's `web.run` (search, open, find, click, …) for any model, via the openai-codex search endpoint. Env: `PI_WEB_MODE` (`live` default, `cached`, `indexed`), `PI_WEB_MODEL`. Mirrors upstream Codex; run `scripts/codex-sync.sh` to see upstream changes since the baseline.

## Skills

_None yet._

## Prompts

_None yet._

## Themes

_None yet._
