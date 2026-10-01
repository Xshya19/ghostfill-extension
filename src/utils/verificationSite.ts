import { rootDomain } from './core';

// Exact first-party domain aliases only. Shared mail hosts and user-published
// notion.site pages must never confer trust over a product's signup page.
const AUTH_SITE_ALIASES: Readonly<Record<string, string>> = {
  'notion.so': 'notion.com',
  // The official legacy chat domain redirects to https://chat.qwen.ai/.
  // https://qwenlm.github.io/blog/qwen2.5-max/ links to chat.qwenlm.ai.
  'qwenlm.ai': 'qwen.ai',
  // Claude's official login help lists @mail.anthropic.com as its mail sender:
  // https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account
  'anthropic.com': 'claude.ai',
  'claude.com': 'claude.ai',
};

export function verificationSiteRoot(hostname: string): string {
  const root = rootDomain(hostname.toLowerCase().replace(/\.$/, ''));
  return AUTH_SITE_ALIASES[root] ?? root;
}

export function sameVerificationSite(first: string, second: string): boolean {
  const root = verificationSiteRoot(first);
  return Boolean(root) && root === verificationSiteRoot(second);
}
