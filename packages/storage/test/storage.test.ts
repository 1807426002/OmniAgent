import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import DexieModule, { type DexieConstructor } from 'dexie/dist/dexie.js';
import { OmniAgentDatabase, OmniAgentStorage } from '../src/index.js';

const Dexie = DexieModule as unknown as DexieConstructor;

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent<T = unknown> extends Event {
    readonly detail: T;
    constructor(type: string, params?: CustomEventInit<T>) {
      super(type, params);
      this.detail = params?.detail as T;
    }
  } as typeof CustomEvent;
}

function createStorage() {
  return new OmniAgentStorage(new OmniAgentDatabase(`omni-agent-test-${randomUUID()}`));
}

test('stores providers, conversations, messages, and settings locally', async (t) => {
  const storage = createStorage();
  t.after(() => storage.db.delete());

  await storage.upsertProvider({
    id: 'deepseek',
    name: 'DeepSeek',
    adapter: 'deepseek',
    capabilities: ['conversation'],
  });
  const conversation = await storage.getOrCreateConversation({
    providerId: 'deepseek',
    externalId: 'session-1',
    title: '测试会话',
  });
  await storage.upsertMessage({
    conversationId: conversation.id,
    externalId: 'user-1',
    role: 'user',
    content: '你好',
    attachments: [],
  });
  await storage.upsertMessage({
    conversationId: conversation.id,
    externalId: 'assistant-1',
    role: 'assistant',
    content: '初始回复',
    attachments: [],
  });
  await storage.upsertMessage({
    conversationId: conversation.id,
    externalId: 'assistant-1',
    role: 'assistant',
    content: '流式回复完成',
    attachments: [],
  });
  await storage.setSetting('theme', 'dark');
  await storage.saveSkill({
    id: 'concise-reply',
    name: 'concise-reply',
    version: '1.0.0',
    description: '简洁回复',
    prompt: '请简洁回答',
    tools: [],
    permissions: [],
    triggers: ['简洁'],
    workflow: [],
    knowledge: [],
    enabled: true,
    source: 'builtin',
  });

  const conversations = await storage.listConversations('deepseek');
  const messages = await storage.listMessages(conversation.id);
  const skills = await storage.listSkills();

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0]?.externalId, 'session-1');
  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.content, '流式回复完成');
  assert.equal(await storage.getSetting('theme'), 'dark');
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.name, 'concise-reply');

  await storage.saveAgentTask({
    id: 'task-1',
    goal: '测试任务',
    status: 'completed',
    steps: [{ id: 's1', index: 0, type: 'finish', title: 'done', createdAt: Date.now() }],
    result: 'ok',
    error: null,
    providerId: 'deepseek',
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const tasks = await storage.listAgentTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.goal, '测试任务');

  await storage.updateConversationTitle(conversation.id, '更新标题');
  assert.equal((await storage.listConversations('deepseek'))[0]?.title, '更新标题');
  await storage.deleteConversation(conversation.id);
  assert.equal((await storage.listConversations('deepseek')).length, 0);
  assert.equal((await storage.listMessages(conversation.id)).length, 0);

  const project = await storage.saveProject({
    id: 'project-1',
    name: 'OmniAgent',
    description: '个人 AI 系统',
    context: '跨平台记忆与工具',
    status: 'active',
  });
  await storage.setActiveProjectId(project.id);
  assert.equal(await storage.getActiveProjectId(), 'project-1');
  assert.equal((await storage.listProjects())[0]?.name, 'OmniAgent');

  const projectConversation = await storage.getOrCreateConversation({
    providerId: 'kimi',
    externalId: 'kimi-1',
    title: '项目会话',
    projectId: 'project-1',
  });
  assert.equal(projectConversation.projectId, 'project-1');
  // Existing project binding should not be overwritten by a later active project.
  const rebound = await storage.getOrCreateConversation({
    providerId: 'kimi',
    externalId: 'kimi-1',
    projectId: 'project-2',
  });
  assert.equal(rebound.projectId, 'project-1');
  assert.equal((await storage.listConversations('kimi', 'project-1')).length, 1);
  assert.equal((await storage.listConversations('deepseek', 'project-1')).length, 0);

  await storage.saveMemory({
    type: 'knowledge',
    scope: 'global',
    providerId: null,
    projectId: null,
    content: 'to-clear',
    summary: 'to-clear',
    keywords: ['clear'],
    importance: 0.5,
    confidence: 0.5,
  });
  assert.ok((await storage.clearMemories()) >= 1);
  assert.equal((await storage.listMemories()).length, 0);
  assert.ok((await storage.clearAgentTasks()) >= 1);
  assert.equal((await storage.listAgentTasks()).length, 0);
});

test('keeps local session chunks with their conversation lifecycle', async (t) => {
  const storage = createStorage();
  t.after(() => storage.db.delete());
  const conversation = await storage.getOrCreateConversation({ providerId: 'deepseek', externalId: 'session-archive' });
  await storage.saveSessionChunk({
    sourceKey: `${conversation.id}:one:eight`,
    conversationId: conversation.id,
    providerId: 'deepseek',
    projectId: null,
    summary: '用户讨论了 pnpm 工作区设置。',
    keywords: ['pnpm', '工作区'],
    messageIds: ['one', 'eight'],
    startedAt: 1,
    endedAt: 2,
  });
  assert.equal((await storage.listSessionChunks({ conversationId: conversation.id })).length, 1);
  assert.equal((await storage.searchSessionChunks('pnpm')).length, 1);
  await storage.deleteConversation(conversation.id);
  assert.equal((await storage.listSessionChunks({ conversationId: conversation.id })).length, 0);
});

test('deduplicates file artifacts by hash and keeps fact provenance', async (t) => {
  const storage = createStorage();
  t.after(() => storage.db.delete());

  const staged = await storage.saveMemoryArtifact({
    contentHash: 'sha256:exam-document',
    fileName: '地理信息安全考试.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 4096,
    providerId: 'deepseek',
    conversationId: 'conversation-1',
    projectId: null,
    status: 'staged',
    dataBase64: 'AAECAw==',
  });
  const imported = await storage.saveMemoryArtifact({
    contentHash: staged.contentHash,
    fileName: staged.fileName,
    mimeType: staged.mimeType,
    size: staged.size,
    providerId: staged.providerId,
    conversationId: staged.conversationId,
    projectId: staged.projectId,
    status: 'imported',
    dataBase64: null,
    error: null,
    importedAt: 1234,
  });

  assert.equal(imported.id, staged.id);
  assert.equal(imported.createdAt, staged.createdAt);
  assert.equal(imported.status, 'imported');
  assert.equal(imported.dataBase64, null);
  assert.equal(imported.importedAt, 1234);
  assert.equal(await storage.db.memoryArtifacts.count(), 1);
  assert.equal((await storage.getMemoryArtifactByHash(staged.contentHash))?.id, staged.id);
  assert.equal((await storage.listMemoryArtifacts({ status: 'imported', providerId: 'deepseek' })).length, 1);
  assert.equal((await storage.listMemoryArtifacts({ projectId: null })).length, 1);

  const now = Date.now();
  await storage.saveMemoryFact({
    id: 'fact-with-artifact',
    identityKey: 'global:knowledge:exam-21',
    canonicalKey: 'exam-21',
    type: 'knowledge',
    scope: 'global',
    scopeKey: 'global',
    providerId: null,
    projectId: null,
    value: '第 21 题答案是 ABCD。',
    normalizedValue: '第 21 题答案是 abcd。',
    valueHash: 'fact-value-hash',
    summary: '第 21 题答案',
    keywords: ['21', 'ABCD'],
    status: 'active',
    sensitivity: 'normal',
    injectionPolicy: 'relevant',
    importance: 0.8,
    confidence: 0.95,
    pinned: false,
    sourceCount: 1,
    accessCount: 0,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: null,
    archivedAt: null,
    deletedAt: null,
    artifactId: staged.id,
    artifactLocator: { page: 3, section: '必对题', question: '21' },
  });
  await storage.saveMemoryEvidence({
    id: 'evidence-with-artifact',
    factId: 'fact-with-artifact',
    sourceKind: 'file_import',
    sourceMessageId: null,
    excerpt: '21. 在境外活动要注意的保密事项……答案：ABCD',
    valueHash: 'fact-value-hash',
    createdAt: now,
    artifactId: staged.id,
    artifactLocator: { page: 3, question: '21' },
  });

  const detail = await storage.getMemoryFactDetail('fact-with-artifact');
  assert.equal(detail?.fact.artifactId, staged.id);
  assert.equal(detail?.fact.artifactLocator?.question, '21');
  assert.equal(detail?.evidence[0]?.artifactLocator?.page, 3);

  await storage.clearMemories();
  assert.equal(await storage.db.memoryArtifacts.count(), 0);
});

test('version 11 adds artifact storage without changing version 10 memory records', async (t) => {
  const name = `omni-agent-v10-upgrade-${randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(10).stores({
    memoryFacts: '&id, &identityKey',
    memoryEvidence: '&id, factId',
  });
  await legacy.open();
  await legacy.table('memoryFacts').add({ id: 'legacy-fact', identityKey: 'legacy:key', value: '必须保留' });
  await legacy.table('memoryEvidence').add({ id: 'legacy-evidence', factId: 'legacy-fact', excerpt: '旧证据' });
  legacy.close();

  const upgraded = new OmniAgentDatabase(name);
  t.after(() => upgraded.delete());
  await upgraded.open();

  assert.equal(upgraded.verno, 11);
  assert.equal((await upgraded.memoryFacts.get('legacy-fact'))?.value, '必须保留');
  assert.equal((await upgraded.memoryEvidence.get('legacy-evidence'))?.excerpt, '旧证据');
  assert.equal(await upgraded.memoryArtifacts.count(), 0);
});

test('moves artifact conversation provenance when temporary conversations are merged', async (t) => {
  const storage = createStorage();
  t.after(() => storage.db.delete());
  const temporary = await storage.getOrCreateConversation({ providerId: 'deepseek', externalId: 'temp:page-1' });
  const target = await storage.getOrCreateConversation({ providerId: 'deepseek', externalId: 'chat-1' });
  const artifact = await storage.saveMemoryArtifact({
    contentHash: 'merge-artifact-hash',
    fileName: '来源.txt',
    mimeType: 'text/plain',
    size: 10,
    providerId: 'deepseek',
    conversationId: temporary.id,
    projectId: null,
    pageSessionId: 'page-1',
  });

  await storage.mergeConversations(temporary.id, target.id);
  assert.equal((await storage.getMemoryArtifact(artifact.id))?.conversationId, target.id);
  await storage.deleteConversation(target.id);
  assert.equal((await storage.getMemoryArtifact(artifact.id))?.conversationId, null);
});
