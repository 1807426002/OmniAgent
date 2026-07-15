import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PermissionManager,
  ToolRegistry,
  ToolExecutor,
  createToolRuntime,
  type BrowserSnapshot,
  type MemorySaveBatchItem,
} from '../src/index.js';

test('registers builtins and describes them for prompt injection', () => {
  const runtime = createToolRuntime({
    services: {
      memory: {
        search: async () => [],
        save: async (input) => input,
        saveBatch: async (items) => items,
      },
      browser: createBrowserService(),
    },
  });

  const names = runtime.list().map((tool) => tool.name);
  assert.deepEqual(names, [
    'browser.click',
    'browser.navigate',
    'browser.scroll',
    'browser.snapshot',
    'browser.type',
    'memory.save',
    'memory.save_batch',
    'memory.search',
  ]);
  assert.match(runtime.describeForPrompt(), /memory\.search/);
});

test('executes memory tools through injected services', async () => {
  const saved: string[] = [];
  let batched: MemorySaveBatchItem[] = [];
  const runtime = createToolRuntime({
    services: {
      memory: {
        search: async (query) => [{ summary: `match:${query}`, score: 1 }],
        save: async (input) => {
          saved.push(input.content);
          return { id: 'm1', content: input.content };
        },
        saveBatch: async (items) => {
          batched = items;
          return {
            saved: items.length,
            candidates: 0,
            rejected: 0,
            items: items.map((_, itemIndex) => ({ itemIndex, chunkIndex: 0, status: 'created', factId: `f${itemIndex}`, candidateId: null })),
          };
        },
      },
    },
  });

  const search = await runtime.execute({ name: 'memory.search', arguments: { query: '偏好' } });
  assert.equal(search.ok, true);
  assert.deepEqual(search.result, [{ summary: 'match:偏好', score: 1 }]);

  const save = await runtime.execute({ name: 'memory.save', arguments: { content: '我喜欢简洁回复' } });
  assert.equal(save.ok, true);
  assert.deepEqual(saved, ['我喜欢简洁回复']);

  const batch = await runtime.execute({
    name: 'memory.save_batch',
    arguments: {
      items: [
        {
          content: '题目 1：答案 A',
          type: 'knowledge',
          sourceQuotes: ['  题目 1：答案 A  ', '题目 1：答案 A'],
          sourceMessageIds: [' message-1 ', 'message-1'],
        },
        {
          content: '题目 2：答案 B',
          importance: 0.9,
          sourceQuotes: ['题目 2：答案 B'],
          sourceMessageIds: ['message-2'],
        },
      ],
    },
  });
  assert.equal(batch.ok, true);
  assert.equal((batch.result as { saved: number }).saved, 2);
  assert.deepEqual(batched[0], {
    content: '题目 1：答案 A',
    type: 'knowledge',
    importance: undefined,
    sourceQuotes: ['题目 1：答案 A'],
    sourceMessageIds: ['message-1'],
  });
});

test('rejects malformed memory.save_batch items individually', async () => {
  const runtime = createToolRuntime({
    services: {
      memory: {
        search: async () => [],
        save: async (input) => input,
        saveBatch: async (items) => items,
      },
    },
  });

  const cases: Array<{ items: unknown[]; error: RegExp }> = [
    {
      items: [{ content: '没有依据' }],
      error: /items\[0\]\.sourceQuotes must be a non-empty array/,
    },
    {
      items: [{ content: '没有消息', sourceQuotes: ['原文'], sourceMessageIds: [] }],
      error: /items\[0\]\.sourceMessageIds must be a non-empty array/,
    },
    {
      items: [{ content: '类型错误', type: 'unknown', sourceQuotes: ['原文'], sourceMessageIds: ['m1'] }],
      error: /items\[0\]\.type must be one of/,
    },
    {
      items: [{ content: '权重错误', importance: 1.1, sourceQuotes: ['原文'], sourceMessageIds: ['m1'] }],
      error: /items\[0\]\.importance must be a finite number between 0 and 1/,
    },
    {
      items: [{ content: '引用错误', sourceQuotes: [''], sourceMessageIds: ['m1'] }],
      error: /items\[0\]\.sourceQuotes must contain only non-empty strings/,
    },
  ];

  for (const item of cases) {
    const result = await runtime.execute({ name: 'memory.save_batch', arguments: { items: item.items } });
    assert.equal(result.ok, true);
    const batch = result.result as { rejected: number; items: Array<{ reason?: string }> };
    assert.equal(batch.rejected, 1);
    assert.match(batch.items[0]?.reason ?? '', item.error);
  }
});

test('continues valid batch items when a sibling item has invalid metadata', async () => {
  const received: string[] = [];
  const runtime = createToolRuntime({
    services: {
      memory: {
        search: async () => [],
        save: async (input) => input,
        saveBatch: async (items) => {
          received.push(...items.map((item) => item.content));
          return {
            saved: items.length,
            candidates: 0,
            rejected: 0,
            items: items.map((_, itemIndex) => ({ itemIndex, chunkIndex: 0, status: 'created', factId: `f${itemIndex}`, candidateId: null })),
          };
        },
      },
    },
  });
  const result = await runtime.execute({
    name: 'memory.save_batch',
    arguments: {
      items: [
        { content: '无来源', sourceQuotes: [], sourceMessageIds: ['m1'] },
        { content: '合法事实', sourceQuotes: ['合法事实'], sourceMessageIds: ['m2'] },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(received, ['合法事实']);
  const batch = result.result as { saved: number; rejected: number; items: Array<{ itemIndex: number; status: string }> };
  assert.equal(batch.saved, 1);
  assert.equal(batch.rejected, 1);
  assert.deepEqual(batch.items.map((item) => [item.itemIndex, item.status]), [[0, 'rejected_schema'], [1, 'created']]);
});

test('checks permissions and validates required parameters', async () => {
  const registry = new ToolRegistry();
  const permissions = new PermissionManager([]);
  const executor = new ToolExecutor(registry, permissions, {
    memory: {
      search: async () => [],
      save: async (input) => input,
      saveBatch: async (items) => items,
    },
  });
  registry.register({
    name: 'memory.search',
    description: 'search',
    source: 'builtin',
    parameters: [{ name: 'query', type: 'string', description: 'q', required: true }],
    permissions: ['memory.read'],
    execute: async () => [],
  });

  const denied = await executor.execute({ name: 'memory.search', arguments: { query: 'x' } });
  assert.equal(denied.ok, false);
  assert.match(denied.error ?? '', /Missing permissions/);

  permissions.grant('memory.read');
  const missing = await executor.execute({ name: 'memory.search', arguments: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? '', /Missing required parameter/);
});

test('executes browser.snapshot via browser service', async () => {
  const snapshot: BrowserSnapshot = {
    url: 'https://chat.deepseek.com',
    title: 'DeepSeek',
    text: 'page body',
    selectedText: 'selected',
    elements: [],
    at: 123,
  };
  const runtime = createToolRuntime({
    services: {
      browser: {
        ...createBrowserService(),
        snapshot: async () => snapshot,
      },
    },
  });
  const result = await runtime.execute({ name: 'browser.snapshot', arguments: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, snapshot);
});

test('executes browser click/type/scroll/navigate tools', async () => {
  const actions: string[] = [];
  const runtime = createToolRuntime({
    services: {
      browser: {
        snapshot: async () => ({
          url: 'https://example.com',
          title: 'Example',
          text: '',
          selectedText: '',
          at: Date.now(),
        }),
        click: async (options) => {
          actions.push(`click:${options.selector ?? options.text}`);
          return { ok: true, action: 'click', detail: 'button', url: 'https://example.com', title: 'Example' };
        },
        type: async (options) => {
          actions.push(`type:${options.value}`);
          return { ok: true, action: 'type', detail: options.value, url: 'https://example.com', title: 'Example' };
        },
        scroll: async (options) => {
          actions.push(`scroll:${options?.direction ?? 'down'}`);
          return { ok: true, action: 'scroll', detail: 'down', url: 'https://example.com', title: 'Example' };
        },
        navigate: async (options) => {
          actions.push(`navigate:${options.url}`);
          return { ok: true, action: 'navigate', detail: options.url, url: options.url, title: '' };
        },
      },
    },
  });

  assert.equal((await runtime.execute({ name: 'browser.click', arguments: { selector: '#go' } })).ok, true);
  assert.equal((await runtime.execute({ name: 'browser.type', arguments: { selector: '#q', value: 'hi' } })).ok, true);
  assert.equal((await runtime.execute({ name: 'browser.scroll', arguments: { direction: 'down' } })).ok, true);
  assert.equal((await runtime.execute({ name: 'browser.navigate', arguments: { url: 'https://github.com' } })).ok, true);
  assert.deepEqual(actions, ['click:#go', 'type:hi', 'scroll:down', 'navigate:https://github.com']);
});

function createBrowserService() {
  return {
    snapshot: async () => ({
      url: 'https://example.com',
      title: 'Example',
      text: 'hello',
      selectedText: '',
      elements: [{ ref: 'e1', tag: 'button', role: 'button', name: 'Go', selector: '#go' }],
      at: Date.now(),
    }),
    click: async () => ({ ok: true as const, action: 'click', detail: 'ok', url: 'https://example.com', title: 'Example' }),
    type: async () => ({ ok: true as const, action: 'type', detail: 'ok', url: 'https://example.com', title: 'Example' }),
    scroll: async () => ({ ok: true as const, action: 'scroll', detail: 'ok', url: 'https://example.com', title: 'Example' }),
    navigate: async (options: { url: string }) => ({
      ok: true as const,
      action: 'navigate',
      detail: options.url,
      url: options.url,
      title: '',
    }),
  };
}
