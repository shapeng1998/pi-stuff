/**
 * codex-web-run: openai/codex `codex-rs/ext/web-search`（web.run）的忠实移植，任意模型可用。
 *
 * 与 Codex 一致：
 * - 端点     POST {openai-codex baseUrl}/codex/alpha/search            （codex-api endpoint/search.rs）
 * - 描述     web_run_description.md 原文（仅 web.run → web_run）       （tool.rs WEB_RUN_DESCRIPTION）
 * - 参数     SearchCommands 全量字段，原样透传（含 response_length）     （codex-api search.rs）
 * - id       会话 ID                                                    （session level_id）
 * - model    当前模型；非 openai-codex 时用 fallback                     （call.model）
 * - input    recent_input：最近 2 条用户消息为界，助手文本共享 1k token  （history.rs）
 * - settings allowed_callers=["direct"]，external_web_access 按模式      （extension.rs search_settings）
 * - max_output_tokens = 10000                                            （models.json truncation_policy）
 * - 输出     服务端 output 原样返回                                     （output.rs SearchOutput）
 * 有意不同：工具名 web_run（Anthropic 不允许 "."）；无 namespace；错误作为工具错误返回给模型（Codex 为 Fatal）。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const CONFIG = {
  /** Codex web_search 模式："cached"（默认）| "indexed" | "live"（Codex 在完全访问沙箱下默认 live） */
  mode: (process.env.PI_WEB_RUN_MODE ?? "cached") as "cached" | "indexed" | "live",
  fallbackModel: process.env.PI_WEB_RUN_MODEL ?? "gpt-5.6-luna",
  /** Codex: call.truncation_policy.token_budget()，models.json 中所有模型均为 tokens/10000 */
  maxOutputTokens: Number(process.env.PI_WEB_RUN_MAX_OUTPUT_TOKENS ?? 10000),
  /** Codex: ASSISTANT_CONTEXT_TOKEN_LIMIT */
  assistantContextTokens: 1000,
  userLocation: undefined as undefined | { country?: string; region?: string; city?: string; timezone?: string },
  searchContextSize: undefined as undefined | "low" | "medium" | "high",
  allowedDomains: undefined as undefined | string[],
};

const DESCRIPTION = "Tool for accessing the internet.\n\n\n---\n\n## Examples of different commands available in this tool\n\nExamples of different commands available in this tool:\n* `search_query`: {\"search_query\": [{\"q\": \"What is the capital of France?\"}, {\"q\": \"What is the capital of belgium?\"}]}. Searches the internet for a given query (and optionally with a domain or recency filter)\n* `image_query`: {\"image_query\":[{\"q\": \"waterfalls\"}]}.\n* `open`: {\"open\": [{\"ref_id\": \"turn0search0\"}, {\"ref_id\": \"https://www.openai.com\", \"lineno\": 120}]}\n* `click`: {\"click\": [{\"ref_id\": \"turn0fetch3\", \"id\": 17}]}\n* `find`: {\"find\": [{\"ref_id\": \"turn0fetch3\", \"pattern\": \"Annie Case\"}]}\n* `screenshot`: {\"screenshot\": [{\"ref_id\": \"turn1view0\", \"pageno\": 0}, {\"ref_id\": \"turn1view0\", \"pageno\": 3}]}\n* `finance`: {\"finance\":[{\"ticker\":\"AMD\",\"type\":\"equity\",\"market\":\"USA\"}]}, {\"finance\":[{\"ticker\":\"BTC\",\"type\":\"crypto\",\"market\":\"\"}]}\n* `weather`: {\"weather\":[{\"location\":\"San Francisco, CA\"}]}\n* `sports`: {\"sports\":[{\"fn\":\"standings\",\"league\":\"nfl\"}, {\"fn\":\"schedule\",\"league\":\"nba\",\"team\":\"GSW\",\"date_from\":\"2025-02-24\"}]}\n* `time`: {\"time\":[{\"utc_offset\":\"+03:00\"}]}\n\n---\n\n## Usage hints\nTo use this tool efficiently:\n* Use multiple commands and queries in one call to get more results faster; e.g. {\"search_query\": [{\"q\": \"bitcoin news\"}], \"finance\":[{\"ticker\":\"BTC\",\"type\":\"crypto\",\"market\":\"\"}], \"find\": [{\"ref_id\": \"turn0search0\", \"pattern\": \"Annie Case\"}, {\"ref_id\": \"turn0search1\", \"pattern\": \"John Smith\"}]}\n* Use \"response_length\" to control the number of results returned by this tool, omit it if you intend to pass \"short\" in\n* Only write required parameters; do not write empty lists or nulls where they could be omitted.\n* `search_query` must have length at most 4 in each call. If it has length > 3, response_length must be medium or long\n* If you find yourself in a situation where you accidentally call the `web_run` tool, it's best just to send an empty query: {\"search_query\": [{\"q\": \"\"}]}.\n\n---\n\n## Decision boundary\n\nIf the user makes an explicit request to search the internet, find latest information, look up, etc (or to not do so), you must obey their request.\nWhen you make an assumption, always consider whether it is temporally stable; i.e. whether there's even a small (>10%) chance it has changed. If it is unstable, you must verify with browsing the internet for verification.\n\n<situations_where_you_must_browse_the_internet>\nBelow is a list of scenarios where browsing the internet MUST be used. PAY CLOSE ATTENTION: you MUST browse the internet in these cases. If you're unsure or on the fence, you MUST bias towards browsing the internet.\n- The information could have changed recently: for example news; prices; laws; schedules; product specs; sports scores; economic indicators; political/public/company figures (e.g. the question relates to 'the president of country A' or 'the CEO of company B', which might change over time); rules; regulations; standards; software libraries that could be updated; exchange rates; recommendations (i.e., recommendations about various topics or things might be informed by what currently exists / is popular / is safe / is unsafe / is in the zeitgeist / etc.); and many many many more categories -- again, if you're on the fence, you MUST browse the internet!\n  - For news queries, prioritize more recent events, ensuring you compare publish dates and the date that the event happened.\n- The user is seeking recommendations that could lead them to spend substantial time or money -- researching products, restaurants, travel plans, etc.\n- The user wants (or would benefit from) direct quotes, links, or precise source attribution.\n- A specific page, paper, dataset, PDF, or site is referenced and you haven't been given its contents.\n- You're unsure about a fact, the topic is niche or emerging, or you suspect there's at least a 10% chance you will incorrectly recall it\n- High-stakes accuracy matters (medical, legal, financial guidance). For these you generally should search by default because this information is highly temporally unstable\n- The user explicitly says to search, browse, verify, or look it up.\n</situations_where_you_must_browse_the_internet>\n\n---\n\n## Citations\n\nResults from `web_run` include internal reference IDs such as `turn2search5`. Use\nthose reference IDs only in calls to `web_run`; do not expose them in the final\nresponse.\n\nCite sources in the final response using Markdown links:\n\n- Cite a single source as `[descriptive source title](https://example.com/page)`.\n- Cite multiple sources with separate Markdown links, for example\n  `[first source](https://example.com/one), [second source](https://example.com/two)`.\n- Link directly to the page that supports the claim. Do not link to search result\n  pages or use bare URLs.\n\nFormatting of citations:\n\n- Place each citation as near as possible to the claim it supports, normally at\n  the end of the sentence or paragraph and after punctuation.\n- Do not place citations inside code fences.\n- Do not put citations on a line by themselves or collect all citations at the\n  end of the response.\n\nIf you browse the internet, cite statements supported by web sources. Each cited\nsource must directly support the associated claim. Prefer primary and\nauthoritative sources, and use sources from different domains when the response\nbenefits from multiple perspectives.\n\n---\n\n## Special cases\nIf these conflict with any other instructions, these should take precedence.\n\n<special_cases>\n- When the user asks for information about how to use OpenAI products, (ChatGPT, the OpenAI API, etc.), you should check the code in local env and only browse as fallback, when you browse restrict your sources to official OpenAI websites using the domains filter, unless otherwise requested.\n- When using search to answer technical questions, you must only rely on primary sources (research papers, official documentation, etc.)\n- Clearly indicate when you are making an inference from sources.\n</special_cases>\n\n---\n\n## Word limits\nResponses may not excessively quote or draw on a specific source. There are several limits here:\n- **Limit on verbatim quotes:**\n  - You may not quote more than 25 words verbatim from any single non-lyrical source, unless the source is reddit.\n  - For song lyrics, verbatim quotes must be limited to at most 10 words.\n  - Long quotes from reddit are allowed, as long as you indicate that those are direct quotes via a markdown blockquote starting with \">\", copy verbatim, and link the source.\n- **Word limits:**\n  - Each webpage source in the sources has a word limit label formatted like \"[wordlim N]\", in which N is the maximum number of words in the whole response that are attributed to that source. If omitted, the word limit is 200 words.\n  - Non-contiguous words derived from a given source must be counted to the word limit.\n  - The summarization limit N is a maximum for each source.\n  - When using multiple sources, their summarization limits add together. However, each article used must be relevant to the response.\n- **Copyright compliance:**\n  - You must avoid providing full articles, long verbatim passages, or extensive direct quotes due to copyright concerns.\n  - If the user asked for a verbatim quote, the response should provide a short compliant excerpt and then answer with paraphrases and summaries.\n  - Again, this limit does not apply to reddit content, as long as it's appropriately indicated that those are direct quotes and you link to the source.\n";

// ── SearchCommands schema（codex-api/src/search.rs，字段与可选性一致，无额外描述） ──
const SearchQuery = Type.Object({
  q: Type.String(),
  recency: Type.Optional(Type.Integer({ minimum: 0 })),
  domains: Type.Optional(Type.Array(Type.String())),
});
const Params = Type.Object({
  search_query: Type.Optional(Type.Array(SearchQuery)),
  image_query: Type.Optional(Type.Array(SearchQuery)),
  open: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), lineno: Type.Optional(Type.Integer({ minimum: 0 })) }))),
  click: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), id: Type.Integer({ minimum: 0 }) }))),
  find: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), pattern: Type.String() }))),
  screenshot: Type.Optional(Type.Array(Type.Object({ ref_id: Type.String(), pageno: Type.Integer({ minimum: 0 }) }))),
  finance: Type.Optional(Type.Array(Type.Object({
    ticker: Type.String(),
    type: Type.Union([Type.Literal("equity"), Type.Literal("fund"), Type.Literal("crypto"), Type.Literal("index")]),
    market: Type.Optional(Type.String()),
  }))),
  weather: Type.Optional(Type.Array(Type.Object({
    location: Type.String(),
    start: Type.Optional(Type.String()),
    duration: Type.Optional(Type.Integer({ minimum: 0 })),
  }))),
  sports: Type.Optional(Type.Array(Type.Object({
    tool: Type.Optional(Type.Literal("sports")),
    fn: Type.Union([Type.Literal("schedule"), Type.Literal("standings")]),
    league: Type.Union(["nba", "wnba", "nfl", "nhl", "mlb", "epl", "ncaamb", "ncaawb", "ipl"].map((l) => Type.Literal(l))),
    team: Type.Optional(Type.String()),
    opponent: Type.Optional(Type.String()),
    date_from: Type.Optional(Type.String()),
    date_to: Type.Optional(Type.String()),
    num_games: Type.Optional(Type.Integer({ minimum: 0 })),
    locale: Type.Optional(Type.String()),
  }))),
  time: Type.Optional(Type.Array(Type.Object({ utc_offset: Type.String() }))),
  response_length: Type.Optional(Type.Union([Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")])),
});

interface Details {
  action: string;
  sources: { title?: string; url?: string; ref_id?: string }[];
  outputChars: number;
}

function accountIdFromJwt(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n");
}

/** codex_utils_output_truncation::approx_token_count ≈ 字节数 / 4 */
const approxTokens = (s: string) => Math.ceil(Buffer.byteLength(s, "utf8") / 4);
function truncateToTokens(s: string, tokens: number): string {
  const bytes = tokens * 4;
  const buf = Buffer.from(s, "utf8");
  return buf.length <= bytes ? s : buf.subarray(0, bytes).toString("utf8").replace(/\uFFFD+$/, "") + "…";
}

/** history.rs::recent_input */
function recentInput(branch: any[], assistantTokenLimit: number) {
  const msgs: { role: "user" | "assistant"; text: string }[] = [];
  for (const entry of branch) {
    if (entry?.type !== "message") continue;
    const m = entry.message;
    const text = textOf(m?.content).trim();
    if (!text) continue;
    if (m.role === "user") msgs.push({ role: "user", text });
    else if (m.role === "assistant") msgs.push({ role: "assistant", text });
  }
  // retain_tail_from_last_n_user_messages(…, 2)：截掉最新用户消息之后的内容，再保留最近 2 条用户消息起的尾部
  const userIdx = msgs.flatMap((m, i) => (m.role === "user" ? [i] : []));
  if (!userIdx.length) return undefined;
  const latest = userIdx[userIdx.length - 1];
  const earliest = userIdx.length >= 2 ? userIdx[userIdx.length - 2] : latest;
  const tail = msgs.slice(earliest, latest + 1);
  // truncate_assistant_output_text_to_token_budget(…, 1000)：按顺序共享预算，超出部分截断，预算耗尽后丢弃
  let remaining = assistantTokenLimit;
  const items: any[] = [];
  for (const m of tail) {
    let text = m.text;
    if (m.role === "assistant") {
      if (remaining === 0) continue;
      const t = approxTokens(text);
      if (t <= remaining) remaining -= t;
      else { text = truncateToTokens(text, remaining); remaining = 0; }
    }
    items.push({ type: "message", role: m.role, content: [{ type: m.role === "user" ? "input_text" : "output_text", text }] });
  }
  return items;
}

/** tool.rs::command_action + web_search_action_detail（仅用于界面显示） */
function describe(p: any): string {
  const qs = (p.search_query ?? p.image_query)?.map((x: any) => x.q) ?? [];
  if (qs.length) return qs.length > 1 && qs[0] ? `${qs[0]} ...` : (qs[0] ?? "");
  const o = p.open?.[0];
  if (o && /^https?:\/\//.test(o.ref_id)) return o.ref_id;
  const f = p.find?.[0];
  if (f) return /^https?:\/\//.test(f.ref_id) ? `'${f.pattern}' in ${f.ref_id}` : `'${f.pattern}'`;
  return Object.keys(p).filter((k) => k !== "response_length").join(", ") || "web_run";
}

const externalWebAccess = (mode: typeof CONFIG.mode) => (mode === "live" ? true : mode === "indexed" ? "indexed" : false);

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof Params, Details>({
    name: "web_run",
    label: "web.run",
    description: DESCRIPTION,
    parameters: Params,
    executionMode: "parallel", // supports_parallel_tool_calls = true

    async execute(_id, params, signal, onUpdate, ctx) {
      const action = describe(params);
      // parse_commands：空参数 → 默认空命令，照常发送
      const commands = Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined));

      const current = ctx.model;
      const modelId = current?.provider === "openai-codex" ? current.id : CONFIG.fallbackModel;
      const model = ctx.modelRegistry.find("openai-codex", modelId) ?? ctx.modelRegistry.find("openai-codex", CONFIG.fallbackModel);
      if (!model) throw new Error(`openai-codex model ${modelId} not found; run /login openai-codex`);
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) throw new Error("No openai-codex credentials. Run /login openai-codex.");
      const accountId = accountIdFromJwt(auth.apiKey);

      const settings: Record<string, unknown> = {};
      if (CONFIG.userLocation) settings.user_location = { type: "approximate", ...CONFIG.userLocation };
      if (CONFIG.searchContextSize) settings.search_context_size = CONFIG.searchContextSize;
      if (CONFIG.allowedDomains) settings.filters = { allowed_domains: CONFIG.allowedDomains };
      settings.allowed_callers = ["direct"];
      settings.external_web_access = externalWebAccess(CONFIG.mode);

      const input = recentInput(ctx.sessionManager.getBranch(), CONFIG.assistantContextTokens);
      const body = {
        id: ctx.sessionManager.getSessionId(),
        model: model.id,
        ...(input ? { input } : {}),
        commands,
        settings,
        max_output_tokens: CONFIG.maxOutputTokens,
      };

      onUpdate?.({ content: [{ type: "text", text: `web.run: ${action}` }], details: { action, sources: [], outputChars: 0 } });

      const baseUrl = (auth.baseUrl ?? model.baseUrl).replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/codex/alpha/search`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          ...(accountId ? { "chatgpt-account-id": accountId } : {}),
          originator: "codex_cli_rs",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`web.run HTTP ${res.status}: ${raw.slice(0, 300)}`);
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`web.run returned non-JSON: ${raw.slice(0, 200)}`);
      }
      const output: string = json.output ?? "";
      const sources = (json.results ?? [])
        .filter((r: any) => r?.url)
        .map((r: any) => ({ title: r.title, url: r.url, ref_id: r.ref_id }));
      return { content: [{ type: "text", text: output }], details: { action, sources, outputChars: output.length } };
    },

    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("web.run ")) + theme.fg("accent", describe(args)), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const d = result.details;
      if (!d) return new Text("", 0, 0);
      const head = theme.fg("muted", `${d.sources.length} sources · ${d.outputChars} chars`);
      if (!expanded) return new Text(head, 0, 0);
      const lines = d.sources.slice(0, 15).map((s) => `  ${theme.fg("dim", s.ref_id ?? "")} ${s.title ?? ""} ${theme.fg("muted", s.url ?? "")}`);
      return new Text([head, ...lines].join("\n"), 0, 0);
    },
  });
}
