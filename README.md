# pi-stuff

Personal [pi](https://pi.dev) package: extensions I use, shared as-is.

```sh
pi install git:github.com/shapeng1998/pi-stuff
```

## Extensions

### `web`

Codex's `web.run` tool (search, image search, open, find, click, screenshot, finance, weather, sports, time) for any pi model.

- Requires a ChatGPT subscription: run `/login openai-codex` in pi first.
- Pages are fetched live.
- Mirrors only the API from upstream Codex (baseline and history links are in the file header).

> Unofficial and not affiliated with OpenAI. It calls the undocumented `/codex/alpha/search` endpoint with your own ChatGPT credentials, so it may break at any time; use it under OpenAI's terms.

### `codex-limits`

Remaining Codex 5h and weekly limits on the right of the footer's first line, e.g. `5h 77% 7d 39% left`.

- Requires `/login openai-codex`; refreshed at session start and after each agent run.
- Below 20% a window turns yellow, below 5% red.
- Hidden when the first footer line (cwd, branch, session name) leaves no room.

> Unofficial: reads the undocumented `/wham/usage` endpoint behind Codex's `/status`, and patches pi's built-in footer rendering, so a pi update may break the display.

## Development

```sh
git clone https://github.com/shapeng1998/pi-stuff.git ~/Projects/pi-stuff
pi install ~/Projects/pi-stuff
```

pi loads the package from this directory in place: edit, `pnpm check`, then `/reload`. Bump `version` and update `CHANGELOG.md` for user-visible changes.

## License

[MIT](LICENSE). Parts of `extensions/web.ts` are derived from OpenAI Codex under Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
