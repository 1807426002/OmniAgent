import { DomSiteAdapter } from './dom-adapter.js';

export const deepseekAdapter = new DomSiteAdapter({
  id: 'deepseek',
  // Kept in sync with breezePeak/deepseek-pp's prompt-text-insertion adapter.
  hosts: ['chat.deepseek.com'],
  inputSelectors: ['textarea#chat-input', 'textarea'],
  submitSelectors: [
    'button[type="submit"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'button[class*="send"]',
    'button[class*="submit"]',
    '[role="button"][aria-label*="发送"]',
    '[role="button"][aria-label*="Send"]',
    '[role="button"][class*="send"]',
  ],
  messageSelectors: ['.ds-message'],
  responseSelectors: ['._74c0879', '.ds-assistant-message-main-content'],
  getConversationId(url) {
    const match = url.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  },
});
