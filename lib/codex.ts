/** pi's openai-codex login, for extensions that call the ChatGPT backend themselves. */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const PROVIDER = 'openai-codex';

export async function codexCredentials(ctx: ExtensionContext) {
  const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
  if (!apiKey) throw new Error(`No ${PROVIDER} credentials. Run /login ${PROVIDER}.`);

  // The key is a JWT carrying the account id; pi's login rejects tokens without one.
  const claims = JSON.parse(Buffer.from(apiKey.split('.')[1], 'base64url').toString()) as {
    'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
  };
  const accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id;
  if (!accountId)
    throw new Error(`No ChatGPT account id in the ${PROVIDER} token. Run /login ${PROVIDER}.`);

  return { apiKey, accountId };
}
