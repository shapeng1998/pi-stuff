# pi-stuff

Personal [pi](https://pi.dev) package: extensions I use, shared as-is.

```sh
pi install git:github.com/shapeng1998/pi-stuff
```

## Extensions

### `web`

Codex's `web.run` tool (search, open, find, click, screenshot, finance, weather, sports, time) for any pi model.

- Requires a ChatGPT subscription: run `/login openai-codex` in pi first.
- Pages are fetched live. github.com pages are refused by the endpoint; open `raw.githubusercontent.com` URLs instead.
- Mirrors only the API from upstream Codex (baseline and history links are in the file header).

> Unofficial and not affiliated with OpenAI. It calls the undocumented `/codex/alpha/search` endpoint with your own ChatGPT credentials, so it may break at any time; use it under OpenAI's terms.

## Development

```sh
git clone https://github.com/shapeng1998/pi-stuff.git ~/Projects/pi-stuff
pi install ~/Projects/pi-stuff
```

pi loads the package from this directory in place: edit, `pnpm check`, then `/reload`. Bump `version` and update `CHANGELOG.md` for notable changes.

## License

[MIT](LICENSE). Parts of `extensions/web` are derived from OpenAI Codex under Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
