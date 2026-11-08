# pi-stuff

Personal [pi](https://pi.dev) package, synced across machines with git.

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

- [`web`](extensions/web) — Codex's `web.run` (search, open, find, click, …) for any model, via the openai-codex search endpoint. Mirrors only the API from upstream Codex (links and baseline in the file header).
