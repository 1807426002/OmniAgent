export type MemorySemanticUnitKind = 'heading' | 'paragraph' | 'list-item' | 'question' | 'table' | 'code';

export interface MemorySemanticUnitLocator {
  page?: number;
  section?: string;
  question?: string;
}

export interface MemorySemanticUnit {
  content: string;
  kind: MemorySemanticUnitKind;
  /** Atomic units are never split, even when they exceed the target size. */
  atomic: boolean;
  locator: MemorySemanticUnitLocator;
}

export interface MemorySemanticChunk {
  content: string;
  units: MemorySemanticUnit[];
  startUnit: number;
  endUnit: number;
  pageStart?: number;
  pageEnd?: number;
  sections: string[];
  questions: string[];
}

export interface SemanticTextOptions {
  page?: number;
  initialSection?: string;
}

/**
 * Converts plain text into indivisible semantic units. Questions keep their
 * options/answers, fenced code and tables stay intact, and headings are kept
 * with the first body unit that follows them.
 */
export function textToMemorySemanticUnits(text: string, options: SemanticTextOptions = {}): MemorySemanticUnit[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const units: MemorySemanticUnit[] = [];
  let current: { kind: MemorySemanticUnitKind; lines: string[]; question?: string } | null = null;
  let section = options.initialSection;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join('\n').trim();
    if (content) {
      units.push({
        content,
        kind: current.kind,
        atomic: current.kind !== 'paragraph',
        locator: { page: options.page, section, question: current.question },
      });
    }
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (/^```/u.test(trimmed)) {
      if (!inFence) {
        flush();
        current = { kind: 'code', lines: [line] };
        inFence = true;
      } else {
        current?.lines.push(line);
        flush();
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      current?.lines.push(line);
      continue;
    }

    if (!trimmed) {
      if (current?.kind === 'question') {
        if (current.lines.at(-1) !== '') current.lines.push('');
      } else {
        flush();
      }
      continue;
    }

    if (isTableLine(trimmed)) {
      if (current?.kind !== 'table') {
        flush();
        current = { kind: 'table', lines: [] };
      }
      current.lines.push(line);
      continue;
    }

    const question = questionLabel(lines, index);
    if (question) {
      flush();
      current = { kind: 'question', lines: [line], question };
      continue;
    }

    if (isHeading(trimmed)) {
      flush();
      section = cleanHeading(trimmed);
      current = { kind: 'heading', lines: [line] };
      flush();
      continue;
    }

    if (current?.kind === 'question') {
      current.lines.push(line);
      continue;
    }

    if (isListItem(trimmed)) {
      flush();
      current = { kind: 'list-item', lines: [line] };
      continue;
    }

    if (current?.kind === 'list-item') {
      current.lines.push(line);
      continue;
    }
    if (current?.kind !== 'paragraph') {
      flush();
      current = { kind: 'paragraph', lines: [] };
    }
    current.lines.push(line);
  }
  flush();
  return attachHeadings(units);
}

/** Greedily packs complete semantic units around the requested target size. */
export function chunkMemorySemanticUnits(units: MemorySemanticUnit[], targetLength = 800): MemorySemanticChunk[] {
  if (!Number.isFinite(targetLength) || targetLength < 1) throw new TypeError('targetLength must be a positive number');
  const chunks: MemorySemanticChunk[] = [];
  let pending: MemorySemanticUnit[] = [];
  let pendingStart = 0;

  const flush = () => {
    if (!pending.length) return;
    const pages = pending.map((unit) => unit.locator.page).filter((page): page is number => page !== undefined);
    chunks.push({
      content: pending.map((unit) => unit.content).join('\n\n'),
      units: pending,
      startUnit: pendingStart,
      endUnit: pendingStart + pending.length - 1,
      pageStart: pages.length ? Math.min(...pages) : undefined,
      pageEnd: pages.length ? Math.max(...pages) : undefined,
      sections: unique(pending.map((unit) => unit.locator.section)),
      questions: unique(pending.map((unit) => unit.locator.question)),
    });
    pending = [];
  };

  units.forEach((unit, index) => {
    const nextLength = pending.length
      ? pending.reduce((sum, item) => sum + item.content.length, 0) + (pending.length * 2) + unit.content.length
      : unit.content.length;
    if (pending.length && nextLength > targetLength) flush();
    if (!pending.length) pendingStart = index;
    pending.push(unit);
  });
  flush();
  return chunks;
}

/** Backwards-compatible text-only helper. */
export function splitMemoryAtSemanticBoundaries(text: string, targetLength = 800): string[] {
  return chunkMemorySemanticUnits(textToMemorySemanticUnits(text), targetLength).map((chunk) => chunk.content);
}

function attachHeadings(units: MemorySemanticUnit[]): MemorySemanticUnit[] {
  const result: MemorySemanticUnit[] = [];
  let headings: MemorySemanticUnit[] = [];
  for (const unit of units) {
    if (unit.kind === 'heading') {
      headings.push(unit);
      continue;
    }
    if (headings.length) {
      result.push({
        ...unit,
        content: [...headings.map((heading) => heading.content), unit.content].join('\n\n'),
        atomic: true,
        locator: { ...unit.locator, section: headings.at(-1)?.locator.section ?? unit.locator.section },
      });
      headings = [];
    } else {
      result.push(unit);
    }
  }
  result.push(...headings);
  return result;
}

function questionLabel(lines: string[], index: number): string | null {
  const line = (lines[index] ?? '').trim();
  const explicit = line.match(/^第\s*(\d{1,5})\s*题/iu);
  if (explicit) return `第${explicit[1]}题`;
  const numbered = line.match(/^(\d{1,5})\s*[.、．)）]\s*/u);
  if (!numbered) return null;
  const nearby = lines.slice(index, index + 8).join('\n');
  const looksLikeExam = /[?？（(]\s*[）)]|(?:^|\n)\s*[A-HＡ-Ｈ]\s*[.、:：)）]|(?:^|\n)\s*(?:答案|正确答案)\s*[:：]/imu.test(nearby);
  return looksLikeExam ? `第${numbered[1]}题` : null;
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/u.test(line)
    || /^第[一二三四五六七八九十百千万\d]+[章节篇部分]\s*/u.test(line)
    || /^[一二三四五六七八九十]+[、.]\s*[^，。；：]{2,40}$/u.test(line);
}

function cleanHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/u, '').trim();
}

function isListItem(line: string): boolean {
  return /^(?:[-*+]\s+|\d+[.、．)）]\s+|[A-HＡ-Ｈ][.、．)）]\s*)/u.test(line);
}

function isTableLine(line: string): boolean {
  return /^\|.*\|$/u.test(line) || /\t/u.test(line);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
