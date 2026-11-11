/**
 * codex-usage: remaining Codex (ChatGPT subscription) rate limits in the footer.
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

type Window = { used_percent?: number; limit_window_seconds?: number };
type Usage = { rate_limit?: { primary_window?: Window | null; secondary_window?: Window | null } };
type Limit = { label: string; left: number };

async function fetchLimits(ctx: ExtensionContext): Promise<Limit[]> {
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

  if (!res.ok) throw new Error(`Codex usage failed (${res.status})`);
  const data = (await res.json()) as Usage;

  const limits: Limit[] = [];
  for (const w of [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]) {
    if (w?.used_percent === undefined || !w.limit_window_seconds) continue;
    const hours = w.limit_window_seconds / 3600;
    limits.push({
      label: hours % 24 === 0 ? `${hours / 24}d` : `${Math.round(hours)}h`,
      left: Math.max(0, 100 - w.used_percent),
    });
  }

  return limits;
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
  let limits: Limit[] = [];

  // Nothing reports a failure: the footer keeps the last value, or stays as pi draws it.
  const refresh = async (ctx: ExtensionContext) => {
    try {
      limits = await fetchLimits(ctx);
      // Clearing an unused status key is the only way for an extension to request a re-render.
      ctx.ui.setStatus('codex-usage', undefined);
    } catch {}
  };

  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    FooterComponent.prototype.render = function (width) {
      const lines = originalRender.call(this, width);
      if (!limits.length) return lines;

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
}
