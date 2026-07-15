import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMemorySaveStatus } from '../src/tool-status.js';

test('formats an automatic memory save as a complete visible result', () => {
  assert.equal(
    formatMemorySaveStatus({ ok: true, result: { saved: 2, candidates: 0, rejected: 1 } }),
    '记忆处理完成：已保存 2 条，1 条未保存。',
  );
});

test('distinguishes real conflicts from saved and rejected items', () => {
  assert.equal(
    formatMemorySaveStatus({
      ok: true,
      result: { saved: 1, candidates: 2, rejected: 0, items: [{ status: 'conflict' }, { status: 'conflict' }] },
    }),
    '记忆处理完成：已保存 1 条，2 条存在冲突，需确认。',
  );
  assert.equal(
    formatMemorySaveStatus({
      ok: true,
      result: { saved: 0, candidates: 1, rejected: 0, items: [{ status: 'pending_confirmation' }] },
    }),
    '记忆处理完成：1 条待确认。',
  );
  assert.equal(formatMemorySaveStatus({ ok: false, error: '工具不可用' }), '记忆保存失败：工具不可用');
});
