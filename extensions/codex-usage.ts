/**
 * codex-usage: remaining Codex (ChatGPT subscription) rate limits in the footer, plus `/codex-usage`.
 *
 * Reads `GET https://chatgpt.com/backend-api/wham/usage`, the endpoint behind Codex's `/status`.
 * Undocumented, may change.
 *
 * pi has no API to add to the built-in footer: setStatus() adds a line (which pops in after the
 * fetch) and setFooter() replaces it all. So we wrap FooterComponent.render and right-align the
 * limits on its first line (cwd, branch and session name on the left, right side empty). That
 * line is cut to the terminal width, so the limits are left out when it has no room for them.
 */
import {
  FooterComponent,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { codexCredentials } from '../lib/codex.ts';

type Window = { used_percent?: number; limit_window_seconds?: number; reset_at?: number };
type Usage = {
  plan_type?: string;
  rate_limit?: { primary_window?: Window | null; secondary_window?: Window | null };
};
type Limit = { label: string; left: number; resetAt: Date };

async function fetchUsage(ctx: ExtensionContext): Promise<{ plan?: string; limits: Limit[] }> {
  const { apiKey, accountId } = await codexCredentials(ctx);
  const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'chatgpt-account-id': accountId,
      originator: 'pi',
      Accept: 'application/json',
    },
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Codex usage failed (${res.status}): ${body.slice(0, 1024)}`);
  const data = JSON.parse(body) as Usage;

  const limits: Limit[] = [];
  for (const w of [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]) {
    if (w?.used_percent === undefined || !w.limit_window_seconds || !w.reset_at) continue;
    const hours = w.limit_window_seconds / 3600;
    limits.push({
      label: hours % 24 === 0 ? `${hours / 24}d` : `${Math.round(hours)}h`,
      left: Math.max(0, 100 - w.used_percent),
      resetAt: new Date(w.reset_at * 1000),
    });
  }

  if (!limits.length) throw new Error(`Codex usage has no rate limits: ${body.slice(0, 1024)}`);
  return { plan: data.plan_type, limits };
}

function formatReset(d: Date): string {
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.getTime() - Date.now() < 24 * 3600_000) return time;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function render(theme: ExtensionContext['ui']['theme'], limits: Limit[]): string {
  return limits
    .map(({ label, left }) => {
      const color = left < 5 ? 'error' : left < 20 ? 'warning' : 'dim';
      return theme.fg(color, `${label}:${Math.round(left)}%`);
    })
    .join(' ');
}

export default function (pi: ExtensionAPI) {
  // Called with the footer's `this` below, and put back on shutdown.
  // oxlint-disable-next-line typescript/unbound-method
  const originalRender = FooterComponent.prototype.render;
  let limits: Limit[] | undefined;

  const show = (ctx: ExtensionContext, next: Limit[]) => {
    limits = next;
    // Clearing an unused status key is the only way for an extension to request a re-render.
    ctx.ui.setStatus('codex-usage', undefined);
  };

  // Background refreshes keep the last value on failure; /codex-usage reports errors.
  const refresh = async (ctx: ExtensionContext) => {
    try {
      show(ctx, (await fetchUsage(ctx)).limits);
    } catch {}
  };

  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    FooterComponent.prototype.render = function (width) {
      const lines = originalRender.call(this, width);
      if (!limits) return lines;

      const text = render(ctx.ui.theme, limits);
      const gap = width - visibleWidth(lines[0]) - visibleWidth(text);
      if (gap >= 2) lines[0] += ' '.repeat(gap) + text;
      return lines;
    };

    void refresh(ctx);
  });

  pi.on('session_shutdown', () => {
    FooterComponent.prototype.render = originalRender;
  });

  pi.on('agent_settled', (_event, ctx) => {
    if (ctx.mode === 'tui') void refresh(ctx);
  });

  pi.registerCommand('codex-usage', {
    description: 'Show remaining Codex rate limits',
    handler: async (_args, ctx) => {
      try {
        const usage = await fetchUsage(ctx);
        show(ctx, usage.limits);

        const lines = usage.limits.map(
          (l) => `${l.label}: ${Math.round(l.left)}% left, resets ${formatReset(l.resetAt)}`,
        );
        ctx.ui.notify(
          [`Codex${usage.plan ? ` (${usage.plan})` : ''}`, ...lines].join('\n'),
          'info',
        );
      } catch (e) {
        ctx.ui.notify(e instanceof Error ? e.message : String(e), 'error');
      }
    },
  });
}
