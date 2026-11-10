/**
 * web: Codex's `web.run` for any pi model, via the openai-codex search endpoint.
 *
 * Only the API is mirrored from upstream (baseline openai/codex@c9b4267c, 2026-11-08):
 *   - Commands ↔ https://github.com/openai/codex/commits/main/codex-rs/codex-api/src/search.rs
 *   - search() ↔ https://github.com/openai/codex/commits/main/codex-rs/codex-api/src/endpoint/search.rs
 * To sync: check those histories for commits after the baseline, apply, then bump the baseline.
 * Everything else is our own.
 *
 * Derived parts © 2025 OpenAI, Apache-2.0; see THIRD_PARTY_NOTICES.md.
 */
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import { Type, type Static } from 'typebox';

const PROVIDER = 'openai-codex';
const DESCRIPTION = `Tool for accessing the internet. Put several commands in one call to get results faster.

Reference ids like \`turn0search0\` are for calls to this tool only. Cite sources to the user as Markdown links to the supporting page.`;

// Commands schema ↔ codex-api/src/search.rs

const SearchQuery = Type.Object({
  q: Type.String({ description: 'Search query.' }),
  recency: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: 'Whether to filter by recency, as a number of recent days.',
    }),
  ),
  domains: Type.Optional(
    Type.Array(Type.String(), { description: 'Whether to filter by a specific list of domains.' }),
  ),
});

const Commands = Type.Object({
  search_query: Type.Optional(
    Type.Array(SearchQuery, {
      description: 'Query the internet search engine for a given list of queries.',
    }),
  ),
  image_query: Type.Optional(
    Type.Array(SearchQuery, {
      description: 'Query the image search engine for a given list of queries.',
    }),
  ),
  open: Type.Optional(
    Type.Array(
      Type.Object({
        ref_id: Type.String({ description: 'Reference id or URL to open.' }),
        lineno: Type.Optional(
          Type.Integer({ minimum: 0, description: 'Line number to position the page at.' }),
        ),
      }),
      { description: 'Open pages by reference id or URL.' },
    ),
  ),
  click: Type.Optional(
    Type.Array(
      Type.Object({
        ref_id: Type.String({ description: 'Reference id containing the numbered link.' }),
        id: Type.Integer({ minimum: 0, description: 'Numbered link id to open.' }),
      }),
      { description: 'Open links from previously opened pages.' },
    ),
  ),
  find: Type.Optional(
    Type.Array(
      Type.Object({
        ref_id: Type.String({ description: 'Reference id or URL to search within.' }),
        pattern: Type.String({ description: 'Text pattern to find.' }),
      }),
      { description: 'Find text patterns in pages.' },
    ),
  ),
  screenshot: Type.Optional(
    Type.Array(
      Type.Object({
        ref_id: Type.String({ description: 'Reference id or URL to screenshot.' }),
        pageno: Type.Integer({ minimum: 0, description: 'Zero-indexed PDF page number.' }),
      }),
      { description: 'Take screenshots of PDF pages.' },
    ),
  ),
  finance: Type.Optional(
    Type.Array(
      Type.Object({
        ticker: Type.String({ description: 'Ticker symbol to look up.' }),
        type: StringEnum(['equity', 'fund', 'crypto', 'index'], {
          description: 'Asset type to look up.',
        }),
        market: Type.Optional(
          Type.String({
            description: 'ISO 3166-1 alpha-3 country code, "OTC", or "" for cryptocurrency.',
          }),
        ),
      }),
      { description: 'Look up prices for the given stock symbols.' },
    ),
  ),
  weather: Type.Optional(
    Type.Array(
      Type.Object({
        location: Type.String({ description: 'Location in "Country, Area, City" format.' }),
        start: Type.Optional(
          Type.String({ description: 'Start date in YYYY-MM-DD format. Defaults to today.' }),
        ),
        duration: Type.Optional(
          Type.Integer({ minimum: 0, description: 'Number of days to return. Defaults to 7.' }),
        ),
      }),
      { description: 'Look up weather forecasts.' },
    ),
  ),
  sports: Type.Optional(
    Type.Array(
      Type.Object({
        tool: Type.Optional(
          StringEnum(['sports'], { description: 'Tool name for sports requests.' }),
        ),
        fn: StringEnum(['schedule', 'standings'], { description: 'Sports function to call.' }),
        league: StringEnum(['nba', 'wnba', 'nfl', 'nhl', 'mlb', 'epl', 'ncaamb', 'ncaawb', 'ipl'], {
          description: 'League to look up.',
        }),
        team: Type.Optional(
          Type.String({
            description:
              'Team to look up, using the common 3 or 4 letter alias used in broadcasts.',
          }),
        ),
        opponent: Type.Optional(
          Type.String({ description: 'Opponent to use with `team` when narrowing the lookup.' }),
        ),
        date_from: Type.Optional(Type.String({ description: 'Start date in YYYY-MM-DD format.' })),
        date_to: Type.Optional(Type.String({ description: 'End date in YYYY-MM-DD format.' })),
        num_games: Type.Optional(
          Type.Integer({ minimum: 0, description: 'Number of games to return.' }),
        ),
        locale: Type.Optional(Type.String({ description: 'Locale for the lookup.' })),
      }),
      { description: 'Look up sports schedules and standings.' },
    ),
  ),
  time: Type.Optional(
    Type.Array(
      Type.Object({
        utc_offset: Type.String({ description: 'UTC offset formatted like "+03:00".' }),
      }),
      { description: 'Get time for the given UTC offsets.' },
    ),
  ),
  response_length: Type.Optional(
    StringEnum(['short', 'medium', 'long'], {
      description: 'Set the length of the response to be returned.',
    }),
  ),
});

// Request ↔ codex-api/src/endpoint/search.rs

// pi's openai-codex login rejects tokens without an account id, so a missing one means a broken login.
function accountId(jwt: string): string {
  try {
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
    };
    const id = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    if (!id) throw new Error('missing');
    return id;
  } catch {
    throw new Error(`No ChatGPT account id in the ${PROVIDER} token. Run /login ${PROVIDER}.`);
  }
}

async function search(
  ctx: ExtensionContext,
  commands: Static<typeof Commands>,
  signal: AbortSignal | undefined,
) {
  const registry = ctx.modelRegistry;
  // The model supplies auth and baseUrl; the server requires `model` but currently ignores its value.
  const models = registry.getAvailable().filter((m) => m.provider === PROVIDER);
  const model = models.find((m) => m.id === ctx.model?.id) ?? models.at(0);
  if (!model) throw new Error(`No ${PROVIDER} model available. Run /login ${PROVIDER}.`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey)
    throw new Error(`No ${PROVIDER} credentials. Run /login ${PROVIDER}.`);

  const url = `${(auth.baseUrl ?? model.baseUrl).replace(/\/+$/, '')}/codex/alpha/search`;
  const timeout = AbortSignal.timeout(60_000);
  const res = await fetch(url, {
    method: 'POST',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      'chatgpt-account-id': accountId(auth.apiKey),
      originator: 'pi',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      id: ctx.sessionManager.getSessionId(),
      model: model.id,
      commands,
      settings: { allowed_callers: ['direct'], external_web_access: true }, // live fetch
      max_output_tokens: 10_000,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`web search failed (${res.status}): ${body.slice(0, 1024)}`);
  const data = JSON.parse(body) as { output?: string };
  if (typeof data.output !== 'string')
    throw new Error(`web search returned no output: ${body.slice(0, 1024)}`);
  return data.output;
}

// pi tool

/** One-line summary of a call, following Codex's TUI (ext/web-search/src/tool.rs, tui/src/history_cell/search.rs). */
function summary(p: Static<typeof Commands>): [header: string, detail: string] {
  const queries = [p.search_query, p.image_query].find((q) => q?.length);
  if (queries) return ['Searched the web for', queries.map((q) => q.q).join(', ')];
  const open = p.open?.at(0)?.ref_id;
  if (open && URL.canParse(open)) return ['Opened', open];
  const find = p.find?.at(0);
  if (find)
    return [
      'Searched for',
      `'${find.pattern}'${URL.canParse(find.ref_id) ? ` in ${find.ref_id}` : ''}`,
    ];
  return ['Searched the web', ''];
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'web',
    label: 'web',
    description: DESCRIPTION,
    parameters: Commands,
    executionMode: 'parallel',

    async execute(_id, params, signal, _onUpdate, ctx) {
      const output = await search(ctx, params, signal);
      return { content: [{ type: 'text', text: output }], details: {} };
    },

    renderCall(args, theme) {
      const [header, detail] = summary(args);
      const rest = detail ? ` ${theme.fg('accent', detail.replace(/[\n\r\t]/g, ' '))}` : '';
      const line = theme.fg('toolTitle', theme.bold(header)) + rest;
      // One line like Codex: cut at the terminal width instead of wrapping.
      return { render: (width) => [truncateToWidth(line, width, '…')], invalidate() {} };
    },

    renderResult(result, _options, theme, context) {
      const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      return new Text(
        context.isError ? theme.fg('error', text) : theme.fg('muted', `${text.length} chars`),
        0,
        0,
      );
    },
  });
}
