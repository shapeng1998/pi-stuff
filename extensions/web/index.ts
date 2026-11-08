/**
 * web: Codex's `web.run` for any pi model, via the openai-codex search endpoint.
 *
 * Upstream baseline: openai/codex@c9b4267c (2026-11-08). Each block below names the
 * upstream file it mirrors; keep field order and behavior in step with it.
 * Run scripts/codex-sync.sh to list upstream commits since the baseline.
 *
 * Intentionally different:
 *   - flat tool name `web` instead of namespace `web` + tool `run` (pi tool names have no ".")
 *   - shorter description.md instead of web_run_description.md
 *   - model falls back to an openai-codex model when the current model is from another provider
 *   - no `literature_search_query` (model-gated upstream; no model enables it at baseline)
 *   - assistant-text truncation keeps the head instead of the middle-out marker
 * Not mirrored: workspace/account routing, FedRAMP, proxy redirects, turn-metadata header,
 * telemetry, WebSearchBegin/End events (pi renders the call itself).
 *
 * Env: PI_WEB_MODE = cached | indexed | live (default live, as Codex without a sandbox); PI_WEB_MODEL = fallback model id.
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type TSchema } from "typebox";

const PROVIDER = "openai-codex";
const DESCRIPTION = readFileSync(new URL("./description.md", import.meta.url), "utf8");

// ① Commands schema ↔ codex-api/src/search.rs (SearchCommands and its operation structs)
//    Descriptions are the upstream doc comments; Codex keeps them in the tool definition.

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

// ② Conversation input ↔ ext/web-search/src/history.rs (recent_input)
//    + tools/src/response_history.rs (retain_tail_from_last_n_user_messages, truncate_assistant_output_text_to_token_budget)

const USER_MESSAGE_COUNT = 2;
const ASSISTANT_CONTEXT_TOKEN_LIMIT = 1_000;

// codex_utils_output_truncation::approx_token_count: utf-8 bytes / 4
const approxTokens = (s: string) => Math.ceil(Buffer.byteLength(s) / 4);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
}

function recentInput(branch: any[]) {
  const messages = branch
    .filter((e) => e?.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant"))
    .map((e) => ({ role: e.message.role as "user" | "assistant", text: textOf(e.message.content).trim() }))
    .filter((m) => m.text);

  // retain_tail_from_last_n_user_messages
  const users = messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
  if (!users.length) return undefined;
  const tail = messages.slice(users.at(-USER_MESSAGE_COUNT) ?? users[0], users.at(-1)! + 1);

  // truncate_assistant_output_text_to_token_budget: one budget shared by all assistant text, in order
  let budget = ASSISTANT_CONTEXT_TOKEN_LIMIT;
  const items = tail.flatMap(({ role, text }) => {
    if (role === "assistant") {
      if (budget === 0) return [];
      const tokens = approxTokens(text);
      if (tokens > budget) text = Buffer.from(text).subarray(0, budget * 4).toString().replace(/�+$/, "") + "…";
      budget = Math.max(0, budget - tokens);
    }
    const type = role === "user" ? "input_text" : "output_text";
    return [{ type: "message", role, content: [{ type, text }] }];
  });
  return items.length ? items : undefined;
}

// ③ Settings ↔ ext/web-search/src/extension.rs (search_settings, external_web_access_for_mode)

function searchSettings(mode: string) {
  return {
    allowed_callers: ["direct"],
    external_web_access: mode === "live" ? true : mode === "indexed" ? "indexed" : false,
  };
}

// ④ Request and errors ↔ ext/web-search/src/tool.rs (handle_call, search_error_message)
//    + codex-api/src/endpoint/search.rs (POST alpha/search, SearchResponse)

const MAX_OUTPUT_TOKENS = 10_000; // call.truncation_policy.token_budget(): every model in models.json is tokens/10000
const MAX_SEARCH_ERROR_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 60_000; // pi-only guard; Codex relies on its HTTP client defaults

function searchErrorMessage(message: string): string {
  if (Buffer.byteLength(message) <= MAX_SEARCH_ERROR_BYTES) return message;
  const suffix = "… [truncated]";
  const head = Buffer.from(message).subarray(0, MAX_SEARCH_ERROR_BYTES - Buffer.byteLength(suffix));
  return head.toString().replace(/�+$/, "") + suffix;
}

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
  const model =
    (ctx.model?.provider === PROVIDER ? ctx.model : undefined) ??
    (process.env.PI_WEB_MODEL ? registry.find(PROVIDER, process.env.PI_WEB_MODEL) : undefined) ??
    registry.getAvailable().find((m: any) => m.provider === PROVIDER);
  if (!model) throw new Error(`No ${PROVIDER} model available. Run /login ${PROVIDER}.`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) throw new Error(`No ${PROVIDER} credentials. Run /login ${PROVIDER}.`);

  const input = recentInput(ctx.sessionManager.getBranch());
  const request = {
    id: ctx.sessionManager.getSessionId(),
    model: model.id,
    ...(input && { input }),
    commands,
    settings: searchSettings(process.env.PI_WEB_MODE ?? "live"),
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };

  const account = accountId(auth.apiKey);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(`${(auth.baseUrl ?? model.baseUrl).replace(/\/+$/, "")}/codex/alpha/search`, {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      ...(account && { "chatgpt-account-id": account }),
      originator: "codex_cli_rs",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(request),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(searchErrorMessage(`unexpected status ${res.status}: ${body}`));
  try {
    return JSON.parse(body) as { output: string; results?: any[] };
  } catch (err) {
    throw new Error(searchErrorMessage(`failed to decode search response: ${err}`));
  }
}

// ⑤ pi tool registration and rendering (pi-only)

interface Details {
  action: string;
  sources: { title?: string; url?: string; ref_id?: string }[];
}

/** Short label for the call, after tool.rs command_action: queries, else opened URL, else find pattern. */
function describe(p: any): string {
  const qs: string[] = (p.search_query ?? p.image_query)?.map((x: any) => x.q) ?? [];
  if (qs.length) return qs.length > 1 ? `${qs[0]} …` : qs[0];
  const isUrl = (s?: string) => /^https?:\/\//.test(s ?? "");
  if (isUrl(p.open?.[0]?.ref_id)) return p.open[0].ref_id;
  const f = p.find?.[0];
  if (f) return isUrl(f.ref_id) ? `'${f.pattern}' in ${f.ref_id}` : `'${f.pattern}'`;
  return Object.keys(p).filter((k) => k !== "response_length").join(", ");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof Commands, Details>({
    name: "web",
    label: "web",
    description: DESCRIPTION,
    parameters: Commands,
    executionMode: "parallel",

    async execute(_id, params, signal, onUpdate, ctx) {
      const action = describe(params);
      onUpdate?.({ content: [{ type: "text", text: `web: ${action}` }], details: { action, sources: [] } });
      const { output, results } = await search(ctx, params, signal);
      const sources = (results ?? [])
        .filter((r) => r?.url)
        .map(({ title, url, ref_id }) => ({ title, url, ref_id }));
      return { content: [{ type: "text", text: output ?? "" }], details: { action, sources } };
    },

    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("web ")) + theme.fg("accent", describe(args)), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const d = result.details;
      if (!d) return new Text("", 0, 0);
      const head = theme.fg("muted", `${d.sources.length} sources · ${textOf(result.content).length} chars`);
      if (!expanded) return new Text(head, 0, 0);
      const lines = d.sources
        .slice(0, 15)
        .map((s) => `  ${theme.fg("dim", s.ref_id ?? "")} ${s.title ?? ""} ${theme.fg("muted", s.url ?? "")}`);
      return new Text([head, ...lines].join("\n"), 0, 0);
    },
  });
}
