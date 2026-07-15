type ToolExecutionResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
};

/** Produces a complete user-visible result without requiring another model turn. */
export function formatMemorySaveStatus(execution: ToolExecutionResult): string {
  if (!execution.ok) return `记忆保存失败：${execution.error || '未知错误'}`;
  const result = execution.result && typeof execution.result === 'object'
    ? execution.result as Record<string, unknown>
    : {};
  const saved = count(result.saved);
  const candidates = count(result.candidates);
  const rejected = count(result.rejected);
  const statuses = Array.isArray(result.items)
    ? result.items.map((item) => item && typeof item === 'object' ? (item as { status?: unknown }).status : undefined)
    : [];
  const conflicts = statuses.filter((status) => status === 'conflict').length;
  const pending = statuses.filter((status) => status === 'pending_confirmation').length;
  const otherCandidates = Math.max(0, candidates - conflicts - pending);
  const parts: string[] = [];
  if (saved) parts.push(`已保存 ${saved} 条`);
  if (pending) parts.push(`${pending} 条待确认`);
  if (conflicts) parts.push(`${conflicts} 条存在冲突，需确认`);
  if (otherCandidates) parts.push(`${otherCandidates} 条需确认`);
  if (rejected) parts.push(`${rejected} 条未保存`);
  return parts.length ? `记忆处理完成：${parts.join('，')}。` : '没有提取到可保存的长期信息。';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
