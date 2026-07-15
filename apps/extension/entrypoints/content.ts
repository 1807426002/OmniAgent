import { BrowserPageController } from '@omni-agent/browser-agent';
import { createAdapterRegistry, deepseekAdapter, providerFromAdapter } from '@omni-agent/site-adapters';
import type { AdapterStatus, ExtensionMessage, ExtensionMessageMap } from '@omni-agent/shared';
import { installMainWorldBridge } from '../src/content/main-world-bridge';
import { installMemoryFileStaging } from '../src/content/file-staging';

const adapters = createAdapterRegistry([deepseekAdapter]);
const pageController = new BrowserPageController();

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  main(ctx) {
    const pageSessionId = globalThis.crypto?.randomUUID?.() ?? `page-${Date.now().toString(36)}`;
    const disposeBridge = installMainWorldBridge('deepseek', pageSessionId);
    const adapter = adapters.find(window.location.href);
    const disposeFileStaging = installMemoryFileStaging('deepseek', pageSessionId, () => adapter?.getConversationId() ?? null);
    const hideInternalProtocolMessages = () => adapter?.hideInternalProtocolMessages();
    hideInternalProtocolMessages();
    const internalMessageObserver = new MutationObserver(hideInternalProtocolMessages);
    internalMessageObserver.observe(document, { childList: true, subtree: true, characterData: true });
    const status = (): AdapterStatus => ({
      provider: providerFromAdapter(adapter),
      url: window.location.href,
      conversationId: adapter?.getConversationId() ?? null,
      health: adapter?.inspectHealth(),
    });

    const handleMessage = async (message: ExtensionMessage) => {
      if (message.type === 'omni:adapter-status') return status();
      if (message.type === 'omni:conversation-snapshot' && adapter) return adapter.getLatestTurn();
      if (message.type === 'omni:browser-snapshot') {
        const payload = message.payload as ExtensionMessageMap['omni:browser-snapshot'] | undefined;
        return pageController.snapshot(payload);
      }
      if (message.type === 'omni:browser-click') {
        const payload = message.payload as ExtensionMessageMap['omni:browser-click'] | undefined;
        return pageController.click(payload ?? {});
      }
      if (message.type === 'omni:browser-type') {
        const payload = message.payload as ExtensionMessageMap['omni:browser-type'] | undefined;
        if (!payload) throw new Error('browser.type payload is required');
        return pageController.type(payload);
      }
      if (message.type === 'omni:browser-scroll') {
        const payload = message.payload as ExtensionMessageMap['omni:browser-scroll'] | undefined;
        return pageController.scroll(payload ?? {});
      }
      if (message.type === 'omni:insert-prompt' && adapter) {
        const payload = message.payload as ExtensionMessageMap['omni:insert-prompt'] | undefined;
        if (payload?.message) return adapter.insertPrompt(payload.message).then(() => status());
      }
      if (message.type === 'omni:render-tool-status' && adapter) {
        const payload = message.payload as ExtensionMessageMap['omni:render-tool-status'] | undefined;
        if (payload?.text) return adapter.renderToolStatus(payload.messageId, payload.text);
      }
      if (message.type === 'omni:send-message' && adapter) {
        const payload = message.payload as ExtensionMessageMap['omni:send-message'] | undefined;
        if (payload?.message) return adapter.sendMessage(payload.message).then(() => status());
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(handleMessage);

    let runtimeUnavailable = false;
    const sendUpdate = (payload: ExtensionMessageMap['omni:response-update'], attempt = 0) => {
      if (runtimeUnavailable) return;
      try {
        // Accessing ctx.isValid can itself touch a revoked runtime proxy after an
        // extension reload. Probe the runtime only inside this try block instead.
        const runtime = browser.runtime;
        if (!runtime?.id) {
          runtimeUnavailable = true;
          return;
        }
        void runtime.sendMessage<ExtensionMessage<'omni:response-update'>>({
          type: 'omni:response-update',
          payload,
        }).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          if (/extension context invalidated|context invalidated/iu.test(detail)) {
            runtimeUnavailable = true;
          } else if (/could not establish connection|receiving end does not exist/iu.test(detail) && attempt < 3) {
            window.setTimeout(() => sendUpdate(payload, attempt + 1), 250 * (attempt + 1));
          } else {
            console.warn('[OmniAgent] response observer unavailable', error);
          }
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (/extension context invalidated|context invalidated/iu.test(detail)) {
          runtimeUnavailable = true;
        } else if (/could not establish connection|receiving end does not exist/iu.test(detail) && attempt < 3) {
          window.setTimeout(() => sendUpdate(payload, attempt + 1), 250 * (attempt + 1));
        } else {
          console.warn('[OmniAgent] response observer unavailable', error);
        }
      }
    };
    const stopMessages = adapter?.observeMessages(({ id, role, text }) => {
      if (role !== 'user') return;
      sendUpdate({ provider: providerFromAdapter(adapter) ?? 'deepseek', role, text, messageId: id, conversationId: adapter.getConversationId(), pageSessionId, state: 'settled' });
    });
    const stopResponses = adapter?.observeResponse(({ id, text, conversationId }) => {
      sendUpdate({ provider: providerFromAdapter(adapter) ?? 'deepseek', role: 'assistant', text, messageId: id, conversationId, pageSessionId, state: 'settled' });
    });

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(handleMessage);
      stopMessages?.();
      stopResponses?.();
      internalMessageObserver.disconnect();
      disposeFileStaging();
      disposeBridge();
    });

    if (adapter) console.info(`[OmniAgent] ${adapter.id} adapter active`);
  },
});
