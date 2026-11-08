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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type TSchema } from "typebox";

const PROVIDER = "openai-codex";
const DESCRIPTION = `Tool for accessing the internet. Put several commands in one call to get results faster.

Reference ids like \`turn0search0\` are for calls to this tool only. Cite sources to the user as Markdown links to the supporting page.`;

// Commands schema ↔ codex-api/src/search.rs

const d = <T extends TSchema>(description: string, schema: T) => ({ ...schema, description }) as T;
const opt = Type.Optional;
const str = (description: string) => d(description, Type.String());
const uint = (description: string) => d(description, Type.Integer({ minimum: 0 }));
const oneOf = (description: string, ...values: string[]) =>
  d(description, Type.Union(values.map((v) => Type.Literal(v))));
const list = (description: string, item: Record<string, TSchema>) => opt(d(description, Type.Array(Type.Object(item))));

const SearchQuery = {
  q: str("Search query."),
  recency: opt(uint("Whether to filter by recency, as a number of recent days.")),
  domains: opt(d("Whether to filter by a specific list of domains.", Type.Array(Type.String()))),
};

const Commands = Type.Object({
  search_query: list("Query the internet search engine for a given list of queries.", SearchQuery),
  image_query: list("Query the image search engine for a given list of queries.", SearchQuery),
  open: list("Open pages by reference id or URL.", {
    ref_id: str("Reference id or URL to open."),
    lineno: opt(uint("Line number to position the page at.")),
  }),
  click: list("Open links from previously opened pages.", {
    ref_id: str("Reference id containing the numbered link."),
    id: uint("Numbered link id to open."),
  }),
  find: list("Find text patterns in pages.", {
    ref_id: str("Reference id or URL to search within."),
    pattern: str("Text pattern to find."),
  }),
  screenshot: list("Take screenshots of PDF pages.", {
    ref_id: str("Reference id or URL to screenshot."),
    pageno: uint("Zero-indexed PDF page number."),
  }),
  finance: list("Look up prices for the given stock symbols.", {
    ticker: str("Ticker symbol to look up."),
    type: oneOf("Asset type to look up.", "equity", "fund", "crypto", "index"),
    market: opt(str('ISO 3166-1 alpha-3 country code, "OTC", or "" for cryptocurrency.')),
  }),
  weather: list("Look up weather forecasts.", {
    location: str('Location in "Country, Area, City" format.'),
    start: opt(str("Start date in YYYY-MM-DD format. Defaults to today.")),
    duration: opt(uint("Number of days to return. Defaults to 7.")),
  }),
  sports: list("Look up sports schedules and standings.", {
    tool: opt(oneOf("Tool name for sports requests.", "sports")),
    fn: oneOf("Sports function to call.", "schedule", "standings"),
    league: oneOf("League to look up.", "nba", "wnba", "nfl", "nhl", "mlb", "epl", "ncaamb", "ncaawb", "ipl"),
    team: opt(str("Team to look up, using the common 3 or 4 letter alias used in broadcasts.")),
    opponent: opt(str("Opponent to use with `team` when narrowing the lookup.")),
    date_from: opt(str("Start date in YYYY-MM-DD format.")),
    date_to: opt(str("End date in YYYY-MM-DD format.")),
    num_games: opt(uint("Number of games to return.")),
    locale: opt(str("Locale for the lookup.")),
  }),
  time: list("Get time for the given UTC offsets.", { utc_offset: str('UTC offset formatted like "+03:00".') }),
  response_length: opt(oneOf("Set the length of the response to be returned.", "short", "medium", "long")),
});

// Request ↔ codex-api/src/endpoint/search.rs

function accountId(jwt: string): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return claims["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

async function search(ctx: any, commands: object, signal: AbortSignal | undefined) {
  const registry = ctx.modelRegistry;
  // The model supplies auth and baseUrl; the server requires `model` but currently ignores its value.
  const model =
    ctx.model?.provider === PROVIDER ? ctx.model : registry.getAvailable().find((m: any) => m.provider === PROVIDER);
  if (!model) throw new Error(`No ${PROVIDER} model available. Run /login ${PROVIDER}.`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) throw new Error(`No ${PROVIDER} credentials. Run /login ${PROVIDER}.`);

  const account = accountId(auth.apiKey);
  const timeout = AbortSignal.timeout(60_000);
  const res = await fetch(`${(auth.baseUrl ?? model.baseUrl).replace(/\/+$/, "")}/codex/alpha/search`, {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      ...(account && { "chatgpt-account-id": account }),
      originator: "pi",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      id: ctx.sessionManager.getSessionId(),
      model: model.id,
      commands,
      settings: { allowed_callers: ["direct"], external_web_access: true }, // live fetch
      max_output_tokens: 10_000,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`web search failed (${res.status}): ${body.slice(0, 1000)}`);
  return JSON.parse(body) as { output?: string; results?: { title?: string; url?: string; ref_id?: string }[] };
}

// pi tool

type Source = { title?: string; url?: string; ref_id?: string };

/** Short label for the call: first query, URL or find pattern. */
function describe(p: any): string {
  const first = p.search_query?.[0]?.q ?? p.image_query?.[0]?.q ?? p.open?.[0]?.ref_id ?? p.find?.[0]?.pattern;
  return first ?? Object.keys(p).filter((k) => k !== "response_length").join(", ");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof Commands, { sources: Source[] }>({
    name: "web",
    label: "web",
    description: DESCRIPTION,
    parameters: Commands,
    executionMode: "parallel",

    async execute(_id, params, signal, _onUpdate, ctx) {
      const { output, results } = await search(ctx, params, signal);
      const sources = (results ?? []).filter((r) => r?.url).map(({ title, url, ref_id }) => ({ title, url, ref_id }));
      return { content: [{ type: "text", text: output ?? "" }], details: { sources } };
    },

    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("web ")) + theme.fg("accent", describe(args)), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const sources = result.details?.sources ?? [];
      const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const head = theme.fg("muted", `${sources.length} sources · ${text.length} chars`);
      if (!expanded) return new Text(head, 0, 0);
      const lines = sources
        .slice(0, 15)
        .map((s) => `  ${theme.fg("dim", s.ref_id ?? "")} ${s.title ?? ""} ${theme.fg("muted", s.url ?? "")}`);
      return new Text([head, ...lines].join("\n"), 0, 0);
    },
  });
}
