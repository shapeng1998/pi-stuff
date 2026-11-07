# pi-stuff

Personal [pi](https://pi.dev) package: extensions, skills, prompts and themes, synced across machines with git.

## Setup on a machine

```sh
git clone https://github.com/shapeng1998/pi-stuff.git ~/Projects/pi-stuff
pi install ~/Projects/pi-stuff
```

Then copy the preferences you want from `settings.example.json` into `~/.pi/agent/settings.json`.

pi loads the package from this directory in place, so `git pull` followed by `/reload` (or restarting pi) picks up changes.

## Workflow

- Edit, `pnpm check`, then `/reload` in pi.
- Use `pi config` to toggle individual resources per machine.
- Bump `version` and update `CHANGELOG.md` for notable changes.

## Extensions

- [`codex-web-run.ts`](extensions/codex-web-run.ts) — port of Codex's `web.run` search tool as `web_run`, usable from any model. Env: `PI_WEB_RUN_MODE`, `PI_WEB_RUN_MODEL`, `PI_WEB_RUN_MAX_OUTPUT_TOKENS`.

## Skills

_None yet._

## Prompts

_None yet._

## Themes

_None yet._
