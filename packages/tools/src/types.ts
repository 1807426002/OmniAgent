export type ToolSource = 'builtin' | 'browser' | 'mcp' | 'native' | 'extension';

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ToolParameter {
  name: string;
  type: ToolParameterType;
  description: string;
  required?: boolean;
}

export interface ToolContext {
  providerId?: string | null;
  projectId?: string | null;
  grantedPermissions: ReadonlySet<string>;
  services: ToolServices;
}

export const MEMORY_SAVE_TYPES = [
  'knowledge',
  'preference',
  'profile',
  'project',
  'episode',
  'procedure',
] as const;

export type MemorySaveType = (typeof MEMORY_SAVE_TYPES)[number];

/**
 * A curated memory derived from one or more messages in the active
 * conversation. Quotes are verbatim evidence; message ids identify the
 * conversation records against which the memory service validates them.
 */
export interface MemorySaveBatchItem {
  content: string;
  type?: MemorySaveType;
  importance?: number;
  sourceQuotes: string[];
  sourceMessageIds: string[];
}

export interface ToolServices {
  memory?: {
    search(query: string, options?: { providerId?: string; projectId?: string; limit?: number }): Promise<unknown[]>;
    save(input: { content: string; type?: string; importance?: number }): Promise<unknown>;
    saveBatch(items: MemorySaveBatchItem[]): Promise<unknown>;
  };
  browser?: BrowserToolService;
}

export interface BrowserElementRef {
  ref: string;
  tag: string;
  role: string;
  name: string;
  selector: string;
  href?: string;
  inputType?: string;
  placeholder?: string;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  text: string;
  selectedText: string;
  elements?: BrowserElementRef[];
  at: number;
}

export interface BrowserActionResult {
  ok: true;
  action: string;
  detail: string;
  url: string;
  title: string;
}

export interface BrowserToolService {
  snapshot(options?: {
    includeText?: boolean;
    maxLength?: number;
    includeElements?: boolean;
    maxElements?: number;
  }): Promise<BrowserSnapshot>;
  click(options: { selector?: string; text?: string; exact?: boolean; ref?: string }): Promise<BrowserActionResult>;
  type(options: {
    selector?: string;
    text?: string;
    ref?: string;
    value: string;
    clear?: boolean;
    submit?: boolean;
  }): Promise<BrowserActionResult>;
  scroll(options?: {
    direction?: 'up' | 'down' | 'left' | 'right';
    amount?: number;
    selector?: string;
  }): Promise<BrowserActionResult>;
  navigate(options: { url: string }): Promise<BrowserActionResult>;
}

export interface ToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  name: string;
  description: string;
  source: ToolSource;
  parameters: ToolParameter[];
  permissions: string[];
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

export interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  name: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  source: ToolSource;
  parameters: ToolParameter[];
  permissions: string[];
}
