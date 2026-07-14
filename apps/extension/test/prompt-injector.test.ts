import assert from 'node:assert/strict';
import test from 'node:test';
import { findLikelyPromptInBinary, rewriteProtobufText } from '../src/main-world/prompt-injector.js';

test('rewrites a protobuf string inside a Connect unary request frame', () => {
  const source = new TextEncoder().encode('原问题');
  const replacement = '长期记忆\n\n用户当前问题：原问题';
  const payload = new Uint8Array([0x0a, source.length, ...source]);
  const framed = new Uint8Array([0, 0, 0, 0, payload.length, ...payload]);

  const rewritten = rewriteProtobufText(framed, '原问题', replacement);

  assert.ok(rewritten);
  assert.equal(rewritten[0], 0);
  assert.equal((((rewritten[1] ?? 0) << 24) | ((rewritten[2] ?? 0) << 16) | ((rewritten[3] ?? 0) << 8) | (rewritten[4] ?? 0)) >>> 0, rewritten.length - 5);
  assert.deepEqual(new TextDecoder().decode(rewritten.slice(7)), replacement);
});

test('extracts a Chinese prompt from a Connect unary request without editor input', () => {
  const source = new TextEncoder().encode('我喜欢吃什么');
  const nested = new Uint8Array([0x0a, source.length, ...source]);
  const payload = new Uint8Array([0x22, nested.length, ...nested]);
  const framed = new Uint8Array([0, 0, 0, 0, payload.length, ...payload]);

  assert.equal(findLikelyPromptInBinary(framed), '我喜欢吃什么');
});

test('rewrites a JSON payload inside a Connect unary request frame', () => {
  const payload = new TextEncoder().encode(JSON.stringify({ chat_id: 'chat', message: { content: '我喜欢吃什么' } }));
  const framed = new Uint8Array([0, 0, 0, 0, payload.length, ...payload]);

  const rewritten = rewriteProtobufText(framed, '我喜欢吃什么', '长期记忆\n\n用户当前问题：我喜欢吃什么');

  assert.ok(rewritten);
  const decoded = JSON.parse(new TextDecoder().decode(rewritten.slice(5))) as { message: { content: string } };
  assert.equal(decoded.message.content, '长期记忆\n\n用户当前问题：我喜欢吃什么');
});
