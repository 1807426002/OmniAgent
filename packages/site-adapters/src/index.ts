/**
 * Keeps provider-specific DOM behavior outside Agent Core.
 * Concrete adapters are deliberately deferred until after phase one.
 */
export interface SiteAdapter {
  id: string;
  match(url: string): boolean;
  sendMessage(message: string): Promise<void>;
  observeResponse(callback: (response: string) => void): void;
  getConversationId(): string | null;
}
