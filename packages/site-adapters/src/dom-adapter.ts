import type { ConversationTurn } from '@omni-agent/shared';
import { ResponseObserver } from './response-observer.js';
import type { ModelResponse, ObservedMessage, SiteAdapter } from './index.js';

export interface DomAdapterOptions {
  id: string;
  hosts: readonly string[];
  inputSelectors: readonly string[];
  submitSelectors: readonly string[];
  messageSelectors: readonly string[];
  responseSelectors: readonly string[];
  getConversationId?: (url: URL) => string | null;
}

export class DomSiteAdapter implements SiteAdapter {
  readonly id: string;

  constructor(private readonly options: DomAdapterOptions) {
    this.id = options.id;
  }

  match(url: string): boolean {
    try {
      return this.options.hosts.some((host) => new URL(url).hostname === host);
    } catch {
      return false;
    }
  }

  async sendMessage(message: string): Promise<void> {
    const input = this.findElement<HTMLElement>(this.options.inputSelectors);
    if (!input) throw new Error(`${this.id}: message input was not found`);
    try {
      await this.insertPrompt(message);
      const submit = await this.waitForEnabledSubmit(input);
      if (!submit) throw new Error(`${this.id}: send button was not found or did not become enabled`);
      submit.click();
    } catch (error) {
      // Internal protocol messages are transport only. Never leave one exposed
      // in the provider composer when a site changes its send-button DOM.
      this.clearInternalPrompt(input, message);
      throw error;
    }
  }

  async insertPrompt(message: string): Promise<void> {
    if (!message) throw new Error(`${this.id}: prompt is empty`);
    const input = this.findElement<HTMLElement>(this.options.inputSelectors);
    if (!input) throw new Error(`${this.id}: message input was not found`);

    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, message);
    } else {
      input.textContent = message;
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: message }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }

  hideInternalProtocolMessages(): void {
    const selector = this.options.messageSelectors.join(',');
    const marked = Array.from(document.querySelectorAll(selector))
      .filter((element) => /<omniagent-(?:action|tool-result)\b/iu.test(element.textContent ?? ''));
    const leafMessages = marked.filter((element) => !marked.some((candidate) => candidate !== element && element.contains(candidate)));
    for (const element of leafMessages) {
      element.setAttribute('data-omniagent-internal', 'true');
      (element as HTMLElement).style.setProperty('display', 'none', 'important');
    }
  }

  getLatestTurn(): ConversationTurn {
    const turn: ConversationTurn = { question: '', response: '' };
    this.readMessages().forEach((message) => {
      if (message.role === 'user') {
        turn.question = message.text;
        turn.response = '';
      } else {
        turn.response = message.text;
      }
    });
    return turn;
  }

  observeMessages(callback: (message: ObservedMessage) => void): () => void {
    const previousText = new WeakMap<Element, string>();
    const emitMessages = () => {
      document.querySelectorAll(this.options.messageSelectors.join(',')).forEach((element) => {
        const message = this.readMessage(element);
        if (message?.text && previousText.get(element) !== message.text) {
          previousText.set(element, message.text);
          callback(message);
        }
      });
    };
    emitMessages();
    const observer = new MutationObserver(emitMessages);
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }

  observeResponse(callback: (response: ModelResponse) => void): () => void {
    const responseObserver = new ResponseObserver(callback, {
      getConversationId: () => this.getConversationId(),
    });
    const stopMessages = this.observeMessages((message) => responseObserver.observe(message));
    return () => {
      stopMessages();
      responseObserver.dispose();
    };
  }

  getConversationId(url = window.location.href): string | null {
    return this.options.getConversationId?.(new URL(url)) ?? null;
  }

  private readMessages(): ObservedMessage[] {
    return Array.from(document.querySelectorAll(this.options.messageSelectors.join(',')))
      .map((element) => this.readMessage(element))
      .filter((message): message is ObservedMessage => message !== null);
  }

  private readMessage(element: Element): ObservedMessage | null {
    const responseHosts = Array.from(element.querySelectorAll(this.options.responseSelectors.join(',')))
      .filter((host) => !host.parentElement?.closest(this.options.responseSelectors.join(',')));
    const responseHost = responseHosts.at(-1);
    const text = (responseHost ?? element).textContent?.trim();
    if (!text) return null;
    const role = responseHost ? 'assistant' : 'user';
    const id = this.findMessageId(element, responseHost) ?? `${role}:${text}`;
    return { id, role, text };
  }

  private findMessageId(message: Element, responseHost?: Element): string | null {
    const candidates = [
      message,
      responseHost,
      ...Array.from(message.querySelectorAll('[data-message-id], [data-messageid], [data-id], [data-ds-message-id], [id]')),
    ].filter((element): element is Element => Boolean(element));
    for (const element of candidates) {
      const value = element.getAttribute('data-message-id')
        ?? element.getAttribute('data-messageid')
        ?? element.getAttribute('data-ds-message-id')
        ?? element.getAttribute('data-id');
      if (value) return value;
    }
    return null;
  }

  private findElement<T extends Element>(selectors: readonly string[]): T | null {
    for (const selector of selectors) {
      const element = document.querySelector<T>(selector);
      if (element) return element;
    }
    return null;
  }

  private async waitForEnabledSubmit(input: HTMLElement): Promise<HTMLElement | null> {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const submit = this.findSubmitNearInput(input) ?? this.findElement<HTMLElement>(this.options.submitSelectors);
      if (submit && !isDisabled(submit)) return submit;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }
    return null;
  }

  private findSubmitNearInput(input: HTMLElement): HTMLElement | null {
    const selectors = [...this.options.submitSelectors, '[role="button"][aria-label*="发送"]', '[role="button"][aria-label*="Send"]', '[role="button"][class*="send"]', '[role="button"][class*="submit"]'];
    let container: HTMLElement | null = input;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      for (const selector of selectors) {
        const submit = container.querySelector<HTMLElement>(selector);
        if (submit) return submit;
      }
    }
    return null;
  }

  private clearInternalPrompt(input: HTMLElement, message: string): void {
    const current = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement ? input.value : input.textContent ?? '';
    if (current !== message || !/<omniagent-(?:action|tool-result)\b/iu.test(message)) return;
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, '');
    } else {
      input.textContent = '';
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function isDisabled(element: HTMLElement): boolean {
  return element instanceof HTMLButtonElement
    ? element.disabled
    : element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
}
