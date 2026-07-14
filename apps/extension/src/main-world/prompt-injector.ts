export type ProviderId = 'deepseek' | 'kimi';

export interface PromptInjectorOptions {
  provider: ProviderId;
  isChatRequest: (pathname: string, url: string) => boolean;
  extractPrompt: (body: Record<string, unknown>) => string | null;
  applyPrompt: (body: Record<string, unknown>, prompt: string) => Record<string, unknown> | null;
  alreadyAugmented?: (prompt: string) => boolean;
  rewriteProtobufPrompt?: boolean;
  timeoutMs?: number;
}

const MAIN_WORLD_SOURCE = 'omniagent-main-world';
const CONTENT_SOURCE = 'omniagent-content';
const BRIDGE_REQUEST = 'OMNIAGENT_BRIDGE_REQUEST';
const BRIDGE_INIT = 'OMNIAGENT_BRIDGE_INIT';
const BRIDGE_READY = 'OMNIAGENT_BRIDGE_READY';

type PendingAugmentation = {
  resolve: (prompt: string) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export function installPromptInjector(options: PromptInjectorOptions): void {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const alreadyAugmented = options.alreadyAugmented
    ?? ((prompt: string) => prompt.includes('<omniagent-memory>') || prompt.includes('<omniagent-skill>'));

  let contentPort: MessagePort | null = null;
  const pending = new Map<string, PendingAugmentation>();
  let bridgeTimer: ReturnType<typeof setInterval> | null = null;
  let bridgeAttempts = 0;
  let lastTypedPrompt = '';

  document.documentElement.setAttribute('data-omniagent-main-world', 'ready');
  document.documentElement.setAttribute('data-omniagent-provider', options.provider);

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.source !== CONTENT_SOURCE || event.data?.type !== BRIDGE_INIT || contentPort) return;
    const [port] = event.ports;
    if (!port) return;
    contentPort = port;
    contentPort.onmessage = (portEvent) => handleContentMessage(portEvent.data);
    contentPort.start();
    contentPort.postMessage({ source: MAIN_WORLD_SOURCE, type: BRIDGE_READY });
  });

  bridgeTimer = setInterval(() => {
    if (contentPort || bridgeAttempts >= 100) {
      clearBridgeTimer();
      return;
    }
    bridgeAttempts += 1;
    window.postMessage({ source: MAIN_WORLD_SOURCE, type: BRIDGE_REQUEST }, window.location.origin);
  }, 50);

  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input);
    if (!matchesChat(url)) return originalFetch.call(this, input, init);
    const body = await requestBody(input, init);
    if (body == null) return originalFetch.call(this, input, init);
    const augmentedBody = await augmentBody(body);
    if (!augmentedBody) return originalFetch.call(this, input, init);
    if (typeof init?.body === 'string') return originalFetch.call(this, input, { ...init, body: augmentedBody });
    if (input instanceof Request) return originalFetch.call(this, new Request(input, { body: augmentedBody }));
    return originalFetch.call(this, input, init);
  };

  if (options.rewriteProtobufPrompt) {
    const fetchWithJsonSupport = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = requestUrl(input);
      if (!matchesChat(url) || alreadyAugmented(lastTypedPrompt)) {
        return fetchWithJsonSupport.call(this, input, init);
      }
      const body = await requestBinaryBody(input, init);
      const matchedPrompt = body ? findPromptInBinary(body, lastTypedPrompt) : null;
      const originalPrompt = matchedPrompt ?? (body ? findLikelyPromptInBinary(body) : null) ?? lastTypedPrompt;
      const containsPrompt = Boolean(matchedPrompt);
      console.info('[OmniAgent] Kimi SendMessage intercepted', {
        url,
        bodyBytes: body?.byteLength ?? 0,
        promptLength: lastTypedPrompt.length,
        matchedPromptLength: matchedPrompt?.length ?? 0,
        promptFound: containsPrompt,
        framePrefix: body ? binaryFramePrefix(body) : '',
      });
      reportDiagnostic(
        'kimi-request-observed',
        `已命中 Kimi 发送请求（${body?.byteLength ?? 0} B，输入文本${containsPrompt ? '已定位' : '未定位'}）`,
      );
      if (!body || !originalPrompt) return fetchWithJsonSupport.call(this, input, init);
      const augmentedPrompt = await requestAugmentedPrompt(originalPrompt);
      const rewritten = augmentedPrompt === originalPrompt ? null : rewriteProtobufText(body, originalPrompt, augmentedPrompt);
      if (!rewritten) {
        console.warn('[OmniAgent] Kimi request was not rewritten', {
          memoryContextReturned: augmentedPrompt !== originalPrompt,
        });
        reportDiagnostic('kimi-request-unchanged', '已取得输入文本，但请求未产生可写入的记忆上下文');
        return fetchWithJsonSupport.call(this, input, init);
      }
      lastTypedPrompt = '';
      const rewrittenBody = toArrayBuffer(rewritten);
      console.info('[OmniAgent] Kimi request rewritten', { originalBytes: body.byteLength, rewrittenBytes: rewritten.byteLength });
      reportDiagnostic('kimi-request-augmented', 'Kimi 二进制请求已写入长期记忆/技能');
      if (init?.body != null) return fetchWithJsonSupport.call(this, input, { ...init, body: rewrittenBody });
      if (input instanceof Request) return fetchWithJsonSupport.call(this, new Request(input, { body: rewrittenBody }));
      return fetchWithJsonSupport.call(this, input, init);
    };
    document.addEventListener('input', (event) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) lastTypedPrompt = target.value.trim();
      else if (target instanceof Element) {
        // Kimi emits `input` from a paragraph inside its contenteditable editor,
        // not from the editor element itself. Read the owning editor so the text
        // is available when its protobuf SendMessage request follows.
        const editor = target.closest<HTMLElement>('[contenteditable="true"]');
        if (editor) lastTypedPrompt = (editor.textContent ?? '').trim();
      }
    }, true);
  }

  const requestUrls = new WeakMap<XMLHttpRequest, string>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    requestUrls.set(this, typeof url === 'string' ? url : url.href);
    return originalOpen.call(this, method, url, async, username ?? null, password ?? null);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
    const url = requestUrls.get(this);
    if (!url || !matchesChat(url)) {
      originalSend.call(this, body);
      return;
    }
    if (typeof body === 'string') {
      void augmentBody(body).then((augmentedBody) => {
        originalSend.call(this, augmentedBody ?? body);
      }).catch(() => {
        originalSend.call(this, body);
      });
      return;
    }
    if (!options.rewriteProtobufPrompt || alreadyAugmented(lastTypedPrompt)) {
      originalSend.call(this, body);
      return;
    }

    const capturedPrompt = lastTypedPrompt;
    void requestXhrBinaryBody(body).then(async (binaryBody) => {
      const matchedPrompt = binaryBody ? findPromptInBinary(binaryBody, capturedPrompt) : null;
      const originalPrompt = matchedPrompt ?? (binaryBody ? findLikelyPromptInBinary(binaryBody) : null) ?? capturedPrompt;
      const containsPrompt = Boolean(matchedPrompt);
      console.info('[OmniAgent] Kimi XHR SendMessage intercepted', {
        url,
        bodyBytes: binaryBody?.byteLength ?? 0,
        promptLength: capturedPrompt.length,
        matchedPromptLength: matchedPrompt?.length ?? 0,
        promptFound: containsPrompt,
        framePrefix: binaryBody ? binaryFramePrefix(binaryBody) : '',
      });
      reportDiagnostic(
        'kimi-xhr-request-observed',
        `已命中 Kimi XHR 发送请求（${binaryBody?.byteLength ?? 0} B，输入文本${containsPrompt ? '已定位' : '未定位'}）`,
      );
      if (!binaryBody || !originalPrompt) {
        originalSend.call(this, body);
        return;
      }
      const augmentedPrompt = await requestAugmentedPrompt(originalPrompt);
      const rewritten = augmentedPrompt === originalPrompt ? null : rewriteProtobufText(binaryBody, originalPrompt, augmentedPrompt);
      if (!rewritten) {
        console.warn('[OmniAgent] Kimi XHR request was not rewritten', {
          memoryContextReturned: augmentedPrompt !== originalPrompt,
        });
        reportDiagnostic('kimi-xhr-request-unchanged', '已取得输入文本，但 XHR 请求未产生可写入的记忆上下文');
        originalSend.call(this, body);
        return;
      }
      lastTypedPrompt = '';
      console.info('[OmniAgent] Kimi XHR request rewritten', { originalBytes: binaryBody.byteLength, rewrittenBytes: rewritten.byteLength });
      reportDiagnostic('kimi-xhr-request-augmented', 'Kimi XHR 二进制请求已写入长期记忆/技能');
      originalSend.call(this, toArrayBuffer(rewritten));
    }).catch(() => {
      originalSend.call(this, body);
    });
  };

  function clearBridgeTimer(): void {
    if (!bridgeTimer) return;
    clearInterval(bridgeTimer);
    bridgeTimer = null;
  }

  function handleContentMessage(data: { source?: string; type?: string; id?: string; prompt?: string }): void {
    if (data?.source === CONTENT_SOURCE && data.type === BRIDGE_READY) {
      clearBridgeTimer();
      reportDiagnostic('bridge-ready', `${options.provider} 主世界脚本已连接扩展`);
      return;
    }
    if (data?.source !== CONTENT_SOURCE || data.type !== 'OMNIAGENT_AUGMENT_PROMPT_RESULT' || !data.id) return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timeout);
    request.resolve(typeof data.prompt === 'string' ? data.prompt : '');
  }

  function matchesChat(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.origin);
      return options.isChatRequest(parsed.pathname, parsed.href);
    } catch {
      return false;
    }
  }

  async function augmentBody(body: string): Promise<string | null> {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
    const originalPrompt = options.extractPrompt(parsed);
    if (!originalPrompt || alreadyAugmented(originalPrompt)) return null;

    reportDiagnostic('request-observed', `已捕获 ${options.provider} 对话请求`);
    const prompt = await requestAugmentedPrompt(originalPrompt);
    if (!prompt || prompt === originalPrompt) {
      reportDiagnostic('request-unchanged', '没有匹配到相关记忆/技能或检索未返回');
      return null;
    }
    const next = options.applyPrompt(parsed, prompt);
    if (!next) return null;
    reportDiagnostic('request-augmented', '已将长期记忆/技能写入请求');
    return JSON.stringify(next);
  }

  function requestAugmentedPrompt(prompt: string): Promise<string> {
    if (!contentPort) return Promise.resolve(prompt);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        resolve(prompt);
      }, timeoutMs);
      pending.set(id, { resolve, timeout });
      contentPort?.postMessage({
        source: MAIN_WORLD_SOURCE,
        type: 'OMNIAGENT_AUGMENT_PROMPT',
        id,
        prompt,
        provider: options.provider,
      });
    });
  }

  function reportDiagnostic(stage: string, detail: string): void {
    contentPort?.postMessage({ source: MAIN_WORLD_SOURCE, type: 'OMNIAGENT_DIAGNOSTIC', stage, detail });
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return null;
    }
  }
  return null;
}

async function requestBinaryBody(input: RequestInfo | URL, init?: RequestInit): Promise<Uint8Array | null> {
  const body = init?.body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (input instanceof Request) {
    try { return new Uint8Array(await input.clone().arrayBuffer()); } catch { return null; }
  }
  return null;
}

async function requestXhrBinaryBody(body: unknown): Promise<Uint8Array | null> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return null;
}

function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }

function containsBytes(source: Uint8Array, target: Uint8Array): boolean {
  if (!target.length || target.length > source.length) return false;
  for (let start = 0; start <= source.length - target.length; start += 1) {
    if (target.every((value, index) => source[start + index] === value)) return true;
  }
  return false;
}

function findPromptInBinary(bytes: Uint8Array, capturedPrompt: string): string | null {
  for (const candidate of promptCandidates(capturedPrompt)) {
    if (containsBytes(bytes, utf8(candidate))) return candidate;
  }
  return null;
}

export function findLikelyPromptInBinary(bytes: Uint8Array): string | null {
  const payload = unwrapConnectEnvelope(bytes)?.payload ?? bytes;
  const json = parseJsonPayload(payload);
  if (json !== null) return findLikelyPromptInJson(json);
  return findLikelyPromptInProtobuf(payload, 0);
}

function rewriteJsonText(bytes: Uint8Array, source: string, replacement: string): Uint8Array | null {
  const json = parseJsonPayload(bytes);
  if (json === null) return null;
  const result = replaceJsonString(json, source, replacement);
  return result.changed ? utf8(JSON.stringify(result.value)) : null;
}

function parseJsonPayload(bytes: Uint8Array): unknown | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^[\s\r\n]*[\[{]/u.test(text)) return null;
    return JSON.parse(text) as unknown;
  } catch { return null; }
}

function replaceJsonString(value: unknown, source: string, replacement: string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') return { value: value === source ? replacement : value, changed: value === source };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceJsonString(item, source, replacement);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = replaceJsonString(item, source, replacement);
      next[key] = result.value;
      changed ||= result.changed;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

function findLikelyPromptInJson(value: unknown): string | null {
  if (typeof value === 'string') return decodeLikelyPrompt(utf8(value));
  if (Array.isArray(value)) {
    for (const item of value) {
      const prompt = findLikelyPromptInJson(item);
      if (prompt) return prompt;
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const prompt = findLikelyPromptInJson(item);
      if (prompt) return prompt;
    }
  }
  return null;
}

function findLikelyPromptInProtobuf(bytes: Uint8Array, depth: number): string | null {
  if (depth > 12) return null;
  let cursor = 0;
  while (cursor < bytes.length) {
    const tag = readVarint(bytes, cursor);
    if (!tag || tag.value >>> 3 === 0) return null;
    cursor = tag.next;
    const wireType = tag.value & 7;
    if (wireType === 0) {
      const value = readVarint(bytes, cursor); if (!value) return null; cursor = value.next;
    } else if (wireType === 1) cursor += 8;
    else if (wireType === 5) cursor += 4;
    else if (wireType === 2) {
      const length = readVarint(bytes, cursor); if (!length || length.value > bytes.length - length.next) return null;
      const data = bytes.slice(length.next, length.next + length.value);
      const text = decodeLikelyPrompt(data);
      if (text) return text;
      const nested = findLikelyPromptInProtobuf(data, depth + 1);
      if (nested) return nested;
      cursor = length.next + length.value;
      continue;
    } else return null;
    if (cursor > bytes.length) return null;
  }
  return null;
}

function decodeLikelyPrompt(bytes: Uint8Array): string | null {
  if (!bytes.length || bytes.length > 16_000) return null;
  let text = '';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { return null; }
  // Kimi Chat requests contain many IDs and URLs. A user-visible CJK string is
  // the only stable fallback when the editor's input event is unavailable.
  return /[\u3400-\u9fff]/u.test(text) && !/[\u0000-\u0008\u000e-\u001f]/u.test(text) ? text : null;
}

function promptCandidates(prompt: string): string[] {
  const normalized = prompt.replace(/[\u200B-\u200D\uFEFF]/gu, '').trim();
  return [...new Set([prompt, normalized].filter(Boolean))];
}

function binaryFramePrefix(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 8), (value) => value.toString(16).padStart(2, '0')).join(' ');
}

export function rewriteProtobufText(bytes: Uint8Array, source: string, replacement: string): Uint8Array | null {
  const sourceBytes = utf8(source);
  const replacementBytes = utf8(replacement);
  const envelope = unwrapConnectEnvelope(bytes);
  if (envelope) {
    // Connect unary requests prepend a one-byte flag and four-byte big-endian
    // payload length. The frame itself is not a protobuf message.
    if (envelope.compressed) return null;
    const json = rewriteJsonText(envelope.payload, source, replacement);
    if (json) return wrapConnectEnvelope(envelope.flags, json);
    const result = rewriteProtobufMessage(envelope.payload, sourceBytes, replacementBytes, 0);
    return result?.changed ? wrapConnectEnvelope(envelope.flags, result.bytes) : null;
  }
  const json = rewriteJsonText(bytes, source, replacement);
  if (json) return json;
  const result = rewriteProtobufMessage(bytes, sourceBytes, replacementBytes, 0);
  return result?.changed ? result.bytes : null;
}

function unwrapConnectEnvelope(bytes: Uint8Array): { flags: number; compressed: boolean; payload: Uint8Array } | null {
  if (bytes.length < 5) return null;
  const size = (((bytes[1] ?? 0) << 24) | ((bytes[2] ?? 0) << 16) | ((bytes[3] ?? 0) << 8) | (bytes[4] ?? 0)) >>> 0;
  if (size !== bytes.length - 5) return null;
  const flags = bytes[0] ?? 0;
  return { flags, compressed: Boolean(flags & 1), payload: bytes.slice(5) };
}

function wrapConnectEnvelope(flags: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(payload.length + 5);
  frame[0] = flags;
  frame[1] = (payload.length >>> 24) & 255;
  frame[2] = (payload.length >>> 16) & 255;
  frame[3] = (payload.length >>> 8) & 255;
  frame[4] = payload.length & 255;
  frame.set(payload, 5);
  return frame;
}

function rewriteProtobufMessage(bytes: Uint8Array, source: Uint8Array, replacement: Uint8Array, depth: number): { bytes: Uint8Array; changed: boolean } | null {
  if (depth > 12) return null;
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  let changed = false;
  while (cursor < bytes.length) {
    const fieldStart = cursor;
    const tag = readVarint(bytes, cursor);
    if (!tag || tag.value >>> 3 === 0) return null;
    cursor = tag.next;
    const wireType = tag.value & 7;
    if (wireType === 0) {
      const value = readVarint(bytes, cursor); if (!value) return null; cursor = value.next;
    } else if (wireType === 1) cursor += 8;
    else if (wireType === 5) cursor += 4;
    else if (wireType === 2) {
      const length = readVarint(bytes, cursor); if (!length || length.value > bytes.length - length.next) return null;
      const dataStart = length.next;
      const dataEnd = dataStart + length.value;
      const data = bytes.slice(dataStart, dataEnd);
      let nextData: Uint8Array | null = equalBytes(data, source) ? replacement : null;
      if (!nextData) {
        const nested = rewriteProtobufMessage(data, source, replacement, depth + 1);
        if (nested?.changed) nextData = nested.bytes;
      }
      if (nextData && !changed) {
        chunks.push(bytes.slice(fieldStart, tag.next), encodeVarint(nextData.length), nextData);
        changed = true;
      } else chunks.push(bytes.slice(fieldStart, dataEnd));
      cursor = dataEnd;
      continue;
    } else return null;
    if (cursor > bytes.length) return null;
    chunks.push(bytes.slice(fieldStart, cursor));
  }
  return { bytes: concatBytes(chunks), changed };
}

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0;
  for (let index = 0; index < 5 && start + index < bytes.length; index += 1) {
    const byte = bytes[start + index]!;
    value |= (byte & 127) << (index * 7);
    if (!(byte & 128)) return { value, next: start + index + 1 };
  }
  return null;
}

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value > 127) { bytes.push((value & 127) | 128); value >>>= 7; }
  bytes.push(value);
  return new Uint8Array(bytes);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

export function extractDeepSeekPrompt(body: Record<string, unknown>): string | null {
  return typeof body.prompt === 'string' ? body.prompt : null;
}

export function applyDeepSeekPrompt(body: Record<string, unknown>, prompt: string): Record<string, unknown> {
  return { ...body, prompt };
}

export function extractKimiPrompt(body: Record<string, unknown>): string | null {
  if (typeof body.prompt === 'string') return body.prompt;
  if (typeof body.query === 'string') return body.query;
  if (typeof body.input === 'string') return body.input;
  if (typeof body.content === 'string') return body.content;
  if (typeof body.message === 'string') return body.message;

  const messages = body.messages;
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index] as Record<string, unknown> | undefined;
      if (!item || (item.role !== 'user' && item.role !== 'human')) continue;
      if (typeof item.content === 'string') return item.content;
      if (Array.isArray(item.content)) {
        const text = item.content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && typeof (part as { text?: string }).text === 'string') {
              return (part as { text: string }).text;
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
        if (text) return text;
      }
    }
  }
  return null;
}

export function applyKimiPrompt(body: Record<string, unknown>, prompt: string): Record<string, unknown> | null {
  if (typeof body.prompt === 'string') return { ...body, prompt };
  if (typeof body.query === 'string') return { ...body, query: prompt };
  if (typeof body.input === 'string') return { ...body, input: prompt };
  if (typeof body.content === 'string') return { ...body, content: prompt };
  if (typeof body.message === 'string') return { ...body, message: prompt };

  if (Array.isArray(body.messages)) {
    const messages = body.messages.map((item) => {
      if (!item || typeof item !== 'object') return item;
      return { ...(item as Record<string, unknown>) };
    });
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index] as Record<string, unknown> | undefined;
      if (!item || (item.role !== 'user' && item.role !== 'human')) continue;
      if (typeof item.content === 'string') {
        item.content = prompt;
        return { ...body, messages };
      }
      if (Array.isArray(item.content)) {
        item.content = [{ type: 'text', text: prompt }];
        return { ...body, messages };
      }
    }
  }
  return null;
}

export function isDeepSeekChatPath(pathname: string): boolean {
  return pathname === '/api/v0/chat/completion' || pathname === '/api/v0/chat/regenerate';
}

export function isKimiChatPath(pathname: string, url: string): boolean {
  const lower = `${pathname} ${url}`.toLowerCase();
  return (
    lower.includes('/chat') ||
    lower.includes('/completion') ||
    lower.includes('/conversation') ||
    lower.includes('/stream') ||
    lower.includes('/api/chat') ||
    lower.includes('/v1/chat') ||
    lower.includes('imservice/sendmessage')
  ) && !lower.includes('/static') && !lower.includes('.js') && !lower.includes('.css');
}
