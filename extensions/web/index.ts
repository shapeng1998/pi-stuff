/**
 * web: Codex's `web.run` tool for any pi model, backed by the openai-codex search endpoint.
 *
 * Mirrors openai/codex codex-rs (web search extension):
 *   request    POST {baseUrl}/codex/alpha/search            codex-api endpoint/search.rs
 *   commands   SearchCommands, passed through unchanged      codex-api search.rs
 *   id         session id                                   session level_id
 *   model      current model if openai-codex, else fallback call.model
 *   input      tail from the last 2 user messages,          history.rs recent_input
 *              assistant text sharing a 1k-token budget
 *   settings   allowed_callers + external_web_access         extension.rs search_settings
 *   output     server `output` returned as-is                output.rs
 *
 * Differences: named `web` (tool names cannot contain "."), shorter description,
 * errors are returned to the model instead of being fatal.
 *
 * Env: PI_WEB_MODE = cached (default) | indexed | live; PI_WEB_MODEL = fallback openai-codex model id.
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const PROVIDER = "openai-codex";
const MODE = process.env.PI_WEB_MODE ?? "cached";
const MAX_OUTPUT_TOKENS = 10_000;
const ASSISTANT_CONTEXT_TOKENS = 1_000;

const DESCRIPTION = readFileSync(new URL("./description.md", import.meta.url), "utf8");

const ref = { ref_id: Type.String() };
const uint = () => Type.Integer({ minimum: 0 });
const opt = Type.Optional;
const list = (item: Parameters<typeof Type.Object>[0]) => opt(Type.Array(Type.Object(item)));
const oneOf = (...values: string[]) => Type.Union(values.map((v) => Type.Literal(v)));
const query = { q: Type.String(), recency: opt(uint()), domains: opt(Type.Array(Type.String())) };

const Params = Type.Object({
  search_query: list(query),
  image_query: list(query),
  open: list({ ...ref, lineno: opt(uint()) }),
  click: list({ ...ref, id: uint() }),
  find: list({ ...ref, pattern: Type.String() }),
  screenshot: list({ ...ref, pageno: uint() }),
  finance: list({ ticker: Type.String(), type: oneOf("equity", "fund", "crypto", "index"), market: opt(Type.String()) }),
  weather: list({ location: Type.String(), start: opt(Type.String()), duration: opt(uint()) }),
  sports: list({
    tool: opt(Type.Literal("sports")),
    fn: oneOf("schedule", "standings"),
    league: oneOf("nba", "wnba", "nfl", "nhl", "mlb", "epl", "ncaamb", "ncaawb", "ipl"),
    team: opt(Type.String()),
    opponent: opt(Type.String()),
    date_from: opt(Type.String()),
    date_to: opt(Type.String()),
    num_games: opt(uint()),
    locale: opt(Type.String()),
  }),
  time: list({ utc_offset: Type.String() }),
  response_length: opt(oneOf("short", "medium", "long")),
});

interface Details {
  action: string;
  sources: { title?: string; url?: string; ref_id?: string }[];
}

// Codex approximates tokens as utf-8 bytes / 4.
const approxTokens = (s: string) => Math.ceil(Buffer.byteLength(s) / 4);
const truncateTokens = (s: string, tokens: number) =>
  Buffer.from(s).subarray(0, tokens * 4).toString().replace(/�+$/, "") + "…";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
}

/** Conversation from the second-to-last through the last user message; assistant text shares one token budget. */
function recentInput(branch: any[]) {
  const msgs = branch
    .filter((e) => e?.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant"))
    .map((e) => ({ role: e.message.role as "user" | "assistant", text: textOf(e.message.content).trim() }))
    .filter((m) => m.text);

  const users = msgs.flatMap((m, i) => (m.role === "user" ? [i] : []));
  if (!users.length) return undefined;
  const tail = msgs.slice(users.at(-2) ?? users.at(-1), users.at(-1)! + 1);

  let budget = ASSISTANT_CONTEXT_TOKENS;
  return tail.flatMap(({ role, text }) => {
    if (role === "assistant") {
      if (budget === 0) return [];
      const tokens = approxTokens(text);
      if (tokens > budget) text = truncateTokens(text, budget);
      budget = Math.max(0, budget - tokens);
    }
    return [{ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] }];
  });
}

/** Short label for the UI: first query, opened URL, or the command names. */
function describe(p: any): string {
  const qs: string[] = (p.search_query ?? p.image_query)?.map((x: any) => x.q) ?? [];
  if (qs.length) return qs.length > 1 ? `${qs[0]} …` : qs[0];
  const isUrl = (s?: string) => /^https?:\/\//.test(s ?? "");
  if (isUrl(p.open?.[0]?.ref_id)) return p.open[0].ref_id;
  const f = p.find?.[0];
  if (f) return isUrl(f.ref_id) ? `'${f.pattern}' in ${f.ref_id}` : `'${f.pattern}'`;
  return Object.keys(p).filter((k) => k !== "response_length").join(", ");
}

function accountId(jwt: string): string | undefined {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof Params, Details>({
    name: "web",
    label: "web",
    description: DESCRIPTION,
    parameters: Params,
    executionMode: "parallel",

    async execute(_id, params, signal, onUpdate, ctx) {
      const action = describe(params);
      const registry = ctx.modelRegistry;
      const model =
        (ctx.model?.provider === PROVIDER ? ctx.model : undefined) ??
        (process.env.PI_WEB_MODEL ? registry.find(PROVIDER, process.env.PI_WEB_MODEL) : undefined) ??
        registry.getAvailable().find((m) => m.provider === PROVIDER);
      if (!model) throw new Error(`No ${PROVIDER} model available. Run /login ${PROVIDER}.`);
      const auth = await registry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) throw new Error(`No ${PROVIDER} credentials. Run /login ${PROVIDER}.`);

      const input = recentInput(ctx.sessionManager.getBranch());
      const body = {
        id: ctx.sessionManager.getSessionId(),
        model: model.id,
        ...(input && { input }),
        commands: params,
        settings: {
          allowed_callers: ["direct"],
          external_web_access: MODE === "live" ? true : MODE === "indexed" ? "indexed" : false,
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
      };

      onUpdate?.({ content: [{ type: "text", text: `web: ${action}` }], details: { action, sources: [] } });

      const account = accountId(auth.apiKey);
      const res = await fetch(`${(auth.baseUrl ?? model.baseUrl).replace(/\/+$/, "")}/codex/alpha/search`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          ...(account && { "chatgpt-account-id": account }),
          originator: "codex_cli_rs",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`web: HTTP ${res.status}: ${raw.slice(0, 300)}`);
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`web: non-JSON response: ${raw.slice(0, 200)}`);
      }

      const sources = (json.results ?? [])
        .filter((r: any) => r?.url)
        .map(({ title, url, ref_id }: any) => ({ title, url, ref_id }));
      return { content: [{ type: "text", text: json.output ?? "" }], details: { action, sources } };
    },

    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("web ")) + theme.fg("accent", describe(args)), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const d = result.details;
      if (!d) return new Text("", 0, 0);
      const chars = textOf(result.content).length;
      const head = theme.fg("muted", `${d.sources.length} sources · ${chars} chars`);
      if (!expanded) return new Text(head, 0, 0);
      const lines = d.sources
        .slice(0, 15)
        .map((s) => `  ${theme.fg("dim", s.ref_id ?? "")} ${s.title ?? ""} ${theme.fg("muted", s.url ?? "")}`);
      return new Text([head, ...lines].join("\n"), 0, 0);
    },
  });
}
