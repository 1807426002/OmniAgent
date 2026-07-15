import type { ExtensionMessage, SupportedProvider } from '@omni-agent/shared';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['docx', 'pdf', 'txt']);
const pendingStages = new Set<Promise<void>>();

export async function waitForPendingMemoryFileStaging(): Promise<void> {
  if (!pendingStages.size) return;
  await Promise.allSettled([...pendingStages]);
}

export function installMemoryFileStaging(
  provider: SupportedProvider,
  pageSessionId: string,
  getConversationId: () => string | null,
): () => void {
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
    for (const file of Array.from(input.files)) queueFile(file);
  };
  document.addEventListener('change', onChange, true);

  async function stageFile(file: File): Promise<void> {
    const extension = file.name.split('.').pop()?.toLocaleLowerCase() ?? '';
    if (!SUPPORTED_EXTENSIONS.has(extension) || file.size > MAX_FILE_SIZE) {
      await browser.runtime.sendMessage({
        type: 'omni:memory-diagnostic',
        payload: {
          stage: 'artifact-rejected',
          detail: !SUPPORTED_EXTENSIONS.has(extension) ? '仅支持 DOCX、PDF 和 TXT 文件' : '文件不能超过 20 MB',
          count: 0,
        },
      }).catch(() => undefined);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const contentHash = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
      await browser.runtime.sendMessage<ExtensionMessage<'omni:stage-memory-artifact'>>({
        type: 'omni:stage-memory-artifact',
        payload: {
          provider,
          pageSessionId,
          conversationId: getConversationId(),
          fileName: file.name,
          mimeType: file.type || mimeFromExtension(extension),
          size: file.size,
          contentHash,
          dataBase64: bytesToBase64(bytes),
        },
      });
    } catch (error) {
      console.warn('[OmniAgent] failed to stage attachment for memory', error);
    }
  }

  function queueFile(file: File): void {
    const task = stageFile(file).finally(() => pendingStages.delete(task));
    pendingStages.add(task);
  }

  return () => document.removeEventListener('change', onChange, true);
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const blockSize = 0x8000;
  for (let index = 0; index < bytes.length; index += blockSize) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + blockSize)));
  }
  return btoa(parts.join(''));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function mimeFromExtension(extension: string): string {
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'pdf') return 'application/pdf';
  return 'text/plain';
}
