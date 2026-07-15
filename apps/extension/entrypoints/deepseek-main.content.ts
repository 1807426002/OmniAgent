import {
  applyDeepSeekPrompt,
  extractDeepSeekPrompt,
  installPromptInjector,
  isDeepSeekChatPath,
} from '../src/main-world/prompt-injector';

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installPromptInjector({
      provider: 'deepseek',
      isChatRequest: (pathname) => isDeepSeekChatPath(pathname),
      extractPrompt: extractDeepSeekPrompt,
      applyPrompt: applyDeepSeekPrompt,
      // File imports parse and persist complete semantic chunks before the
      // provider request continues. A 20 MB document can legitimately exceed
      // the old 10-second bridge timeout.
      timeoutMs: 120_000,
    });
  },
});
