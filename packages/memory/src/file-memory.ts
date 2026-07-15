/// <reference path="./pdfjs-worker.d.ts" />

import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { chunkMemorySemanticUnits, textToMemorySemanticUnits, type MemorySemanticUnit } from './semantic-chunks.js';

export type MemoryFileKind = 'txt' | 'docx' | 'pdf';

export interface MemoryFileInput {
  name: string;
  type?: string;
  data: ArrayBuffer | Uint8Array | string;
}

export interface MemoryFileParseOptions {
  /** Desired chunk size. Boundaries are semantic, so this is not a hard maximum. */
  targetLength?: number;
  /** Defaults to 20 MiB. */
  maxBytes?: number;
}

export interface MemoryFileDescriptor {
  name: string;
  kind: MemoryFileKind;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface MemoryFileSourceLocator {
  fileName: string;
  fileKind: MemoryFileKind;
  pageStart?: number;
  pageEnd?: number;
  sections: string[];
  questions: string[];
  unitStart: number;
  unitEnd: number;
  label: string;
}

export interface MemoryFileChunk {
  content: string;
  locator: MemoryFileSourceLocator;
}

export interface ParsedMemoryFile {
  file: MemoryFileDescriptor;
  units: MemorySemanticUnit[];
  chunks: MemoryFileChunk[];
  warnings: string[];
}

export type MemoryFileParseErrorCode = 'unsupported_type' | 'file_too_large' | 'invalid_file' | 'encrypted_pdf' | 'empty_file';

export class MemoryFileParseError extends Error {
  constructor(readonly code: MemoryFileParseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MemoryFileParseError';
  }
}

export const DEFAULT_MEMORY_FILE_TARGET_LENGTH = 800;
export const MAX_MEMORY_FILE_BYTES = 20 * 1024 * 1024;

/** Parses a supported attachment without depending on extension or storage APIs. */
export async function parseMemoryFile(input: MemoryFileInput, options: MemoryFileParseOptions = {}): Promise<ParsedMemoryFile> {
  const name = input.name.trim();
  if (!name) throw new MemoryFileParseError('invalid_file', 'File name cannot be empty');
  const kind = inferFileKind(name, input.type);
  const bytes = toBytes(input.data);
  const maxBytes = options.maxBytes ?? MAX_MEMORY_FILE_BYTES;
  if (bytes.byteLength > maxBytes) throw new MemoryFileParseError('file_too_large', `File exceeds the ${formatBytes(maxBytes)} limit`);
  if (!bytes.byteLength) throw new MemoryFileParseError('empty_file', 'File is empty');

  const mimeType = normalizedMimeType(kind, input.type);
  let parsed: { units: MemorySemanticUnit[]; warnings: string[] };
  try {
    if (kind === 'txt') parsed = { units: textToMemorySemanticUnits(decodeText(bytes)), warnings: [] };
    else if (kind === 'docx') parsed = await parseDocxUnits(bytes);
    else parsed = await parsePdfUnits(bytes);
  } catch (error) {
    if (error instanceof MemoryFileParseError) throw error;
    throw new MemoryFileParseError('invalid_file', `Unable to parse ${name}`, { cause: error });
  }
  if (!parsed.units.some((unit) => unit.content.trim())) {
    throw new MemoryFileParseError('empty_file', `${name} does not contain extractable text`);
  }

  const file: MemoryFileDescriptor = { name, kind, mimeType, size: bytes.byteLength, sha256: await sha256(bytes) };
  const chunks = chunkMemorySemanticUnits(parsed.units, options.targetLength ?? DEFAULT_MEMORY_FILE_TARGET_LENGTH)
    .map((chunk): MemoryFileChunk => ({
      content: chunk.content,
      locator: {
        fileName: name,
        fileKind: kind,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        sections: chunk.sections,
        questions: chunk.questions,
        unitStart: chunk.startUnit,
        unitEnd: chunk.endUnit,
        label: formatLocator(name, chunk.pageStart, chunk.pageEnd, chunk.sections, chunk.questions),
      },
    }));
  return { file, units: parsed.units, chunks, warnings: parsed.warnings };
}

export function inferFileKind(name: string, mimeType?: string): MemoryFileKind {
  const mime = mimeType?.toLowerCase().split(';', 1)[0]?.trim();
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime === 'application/pdf') return 'pdf';
  if (mime?.startsWith('text/')) return 'txt';
  const extension = name.toLowerCase().match(/\.([^.]+)$/u)?.[1];
  if (extension === 'docx' || extension === 'pdf' || extension === 'txt') return extension;
  throw new MemoryFileParseError('unsupported_type', 'Only DOCX, PDF, and TXT files are supported');
}

async function parseDocxUnits(bytes: Uint8Array): Promise<{ units: MemorySemanticUnit[]; warnings: string[] }> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new MemoryFileParseError('invalid_file', 'The DOCX archive is invalid', { cause: error });
  }
  const documentFile = archive.file('word/document.xml');
  if (!documentFile) throw new MemoryFileParseError('invalid_file', 'DOCX is missing word/document.xml');
  const [documentXml, numberingXml] = await Promise.all([
    documentFile.async('string'),
    archive.file('word/numbering.xml')?.async('string') ?? Promise.resolve(null),
  ]);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', preserveOrder: true });
  let document: unknown;
  try {
    document = parser.parse(documentXml) as unknown;
  } catch (error) {
    throw new MemoryFileParseError('invalid_file', 'DOCX document XML is invalid', { cause: error });
  }
  const body = findElementChildren(document, 'w:body');
  if (!body) throw new MemoryFileParseError('invalid_file', 'DOCX document body is missing');
  const numbering = numberingXml ? parseNumbering(numberingXml) : new Map<string, Map<number, NumberingLevel>>();
  const counters = new Map<string, number[]>();
  const blocks: string[] = [];

  for (const node of body) {
    if (!isObject(node)) continue;
    const paragraph = node['w:p'];
    if (Array.isArray(paragraph)) {
      let content = collectWordText(paragraph).trim();
      if (!content) continue;
      const style = findElementAttribute(paragraph, 'w:pStyle', 'w:val');
      const headingLevel = headingLevelFor(style);
      const numId = findElementAttribute(paragraph, 'w:numId', 'w:val');
      const level = toInteger(findElementAttribute(paragraph, 'w:ilvl', 'w:val')) ?? 0;
      if (headingLevel !== null) content = `${'#'.repeat(headingLevel)} ${content}`;
      else if (numId && !isAlreadyLabelled(content)) content = `${nextListLabel(numId, level, numbering, counters)} ${content}`;
      blocks.push(content);
      continue;
    }
    const table = node['w:tbl'];
    if (Array.isArray(table)) {
      const rows = wordTableRows(table);
      if (rows.length) blocks.push(rows.map((cells) => cells.join('\t')).join('\n'));
    }
  }
  return { units: textToMemorySemanticUnits(blocks.join('\n\n')), warnings: [] };
}

async function parsePdfUnits(bytes: Uint8Array): Promise<{ units: MemorySemanticUnit[]; warnings: string[] }> {
  // A content/background service worker has no `window`, so pdf.js cannot
  // construct its normal Web Worker. Register the bundled worker handler and
  // let pdf.js use its supported in-process transport in that environment.
  const [{ getDocument }, pdfWorker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]).then(([api, worker]) => [api, { WorkerMessageHandler: worker.WorkerMessageHandler }] as const);
  (globalThis as typeof globalThis & { pdfjsWorker?: typeof pdfWorker }).pdfjsWorker ??= pdfWorker;
  const loadingTask = getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false });
  let document: Awaited<typeof loadingTask.promise>;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new MemoryFileParseError('encrypted_pdf', 'Password-protected PDFs are not supported', { cause: error });
    }
    throw new MemoryFileParseError('invalid_file', 'The PDF is invalid or cannot be read', { cause: error });
  }

  const units: MemorySemanticUnit[] = [];
  let section: string | undefined;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = pdfTextContentToText(textContent.items as unknown[]);
      const pageUnits = textToMemorySemanticUnits(pageText, { page: pageNumber, initialSection: section });
      units.push(...pageUnits);
      section = pageUnits.map((unit) => unit.locator.section).filter((value): value is string => Boolean(value)).at(-1) ?? section;
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return { units, warnings: units.length ? [] : ['The PDF may contain only scanned images; OCR is not available.'] };
}

function pdfTextContentToText(items: unknown[]): string {
  const lines: string[] = [];
  let line = '';
  let lastY: number | undefined;
  let lastEndX: number | undefined;
  const flush = () => {
    const value = line.trim();
    if (value) lines.push(value);
    line = '';
    lastEndX = undefined;
  };
  for (const raw of items) {
    if (!isObject(raw) || typeof raw.str !== 'string') continue;
    const transform = Array.isArray(raw.transform) ? raw.transform : [];
    const x = typeof transform[4] === 'number' ? transform[4] : undefined;
    const y = typeof transform[5] === 'number' ? transform[5] : undefined;
    if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2) flush();
    const gap = x !== undefined && lastEndX !== undefined ? x - lastEndX : 0;
    if (line && raw.str && (gap > 1.5 || !/\s$/u.test(line))) line += ' ';
    line += raw.str;
    const width = typeof raw.width === 'number' ? raw.width : 0;
    lastEndX = x === undefined ? undefined : x + width;
    lastY = y ?? lastY;
    if (raw.hasEOL === true) flush();
  }
  flush();
  return lines.join('\n');
}

interface NumberingLevel { format: string; text: string; start: number }

function parseNumbering(xml: string): Map<string, Map<number, NumberingLevel>> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = asObject(parsed['w:numbering']);
  const abstractLevels = new Map<string, Map<number, NumberingLevel>>();
  for (const abstract of asArray(root?.['w:abstractNum'])) {
    const record = asObject(abstract);
    const id = attribute(record, 'w:abstractNumId');
    if (!record || !id) continue;
    const levels = new Map<number, NumberingLevel>();
    for (const value of asArray(record['w:lvl'])) {
      const level = asObject(value);
      const index = toInteger(attribute(level, 'w:ilvl'));
      if (!level || index === null) continue;
      levels.set(index, {
        format: elementValue(level['w:numFmt']) ?? 'decimal',
        text: elementValue(level['w:lvlText']) ?? `%${index + 1}.`,
        start: toInteger(elementValue(level['w:start'])) ?? 1,
      });
    }
    abstractLevels.set(id, levels);
  }
  const result = new Map<string, Map<number, NumberingLevel>>();
  for (const value of asArray(root?.['w:num'])) {
    const num = asObject(value);
    const numId = attribute(num, 'w:numId');
    const abstractId = elementValue(num?.['w:abstractNumId']);
    if (numId && abstractId && abstractLevels.has(abstractId)) result.set(numId, abstractLevels.get(abstractId)!);
  }
  return result;
}

function nextListLabel(numId: string, level: number, numbering: Map<string, Map<number, NumberingLevel>>, state: Map<string, number[]>): string {
  const definition = numbering.get(numId);
  const currentDefinition = definition?.get(level);
  if (!currentDefinition || currentDefinition.format === 'bullet') return '•';
  const counters = state.get(numId) ?? [];
  counters[level] = (counters[level] ?? currentDefinition.start - 1) + 1;
  counters.length = level + 1;
  state.set(numId, counters);
  return currentDefinition.text.replace(/%(\d+)/gu, (_match, position: string) => {
    const counterLevel = Number(position) - 1;
    const value = counters[counterLevel] ?? definition?.get(counterLevel)?.start ?? 1;
    return formatCounter(value, definition?.get(counterLevel)?.format ?? currentDefinition.format);
  });
}

function formatCounter(value: number, format: string): string {
  if (format === 'lowerLetter' || format === 'upperLetter') {
    let result = '';
    for (let remaining = Math.max(1, value); remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
      result = String.fromCharCode(97 + ((remaining - 1) % 26)) + result;
    }
    return format === 'upperLetter' ? result.toUpperCase() : result;
  }
  return String(value);
}

function wordTableRows(table: unknown[]): string[][] {
  return findAllElementChildren(table, 'w:tr').map((row) =>
    findAllElementChildren(row, 'w:tc').map((cell) => {
      const paragraphs = findAllElementChildren(cell, 'w:p').map((paragraph) => collectWordText(paragraph).trim()).filter(Boolean);
      return paragraphs.join(' / ').replace(/\t/gu, ' ');
    }),
  ).filter((row) => row.some(Boolean));
}

function collectWordText(value: unknown): string {
  if (Array.isArray(value)) return value.map(collectWordText).join('');
  if (!isObject(value)) return '';
  let result = '';
  for (const [key, child] of Object.entries(value)) {
    if (key === 'w:t') result += xmlText(child);
    else if (key === 'w:tab') result += '\t';
    else if (key === 'w:br' || key === 'w:cr') result += '\n';
    else if (key !== ':@') result += collectWordText(child);
  }
  return result;
}

function xmlText(value: unknown): string {
  if (Array.isArray(value)) return value.map(xmlText).join('');
  if (!isObject(value)) return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text']);
  return Object.entries(value).filter(([key]) => key !== ':@').map(([, child]) => xmlText(child)).join('');
}

function findElementChildren(value: unknown, element: string): unknown[] | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findElementChildren(item, element);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  const own = value[element];
  if (Array.isArray(own)) return own;
  for (const [key, child] of Object.entries(value)) {
    if (key === ':@') continue;
    const found = findElementChildren(child, element);
    if (found) return found;
  }
  return null;
}

function findAllElementChildren(value: unknown, element: string): unknown[][] {
  const result: unknown[][] = [];
  const visit = (current: unknown) => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (!isObject(current)) return;
    const own = current[element];
    if (Array.isArray(own)) result.push(own);
    for (const [key, child] of Object.entries(current)) if (key !== ':@' && key !== element) visit(child);
  };
  visit(value);
  return result;
}

function findElementAttribute(value: unknown, element: string, attributeName: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findElementAttribute(item, element, attributeName);
      if (result !== null) return result;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (element in value) {
    const attributeValue = asObject(value[':@'])?.[`@_${attributeName}`];
    if (typeof attributeValue === 'string' || typeof attributeValue === 'number') return String(attributeValue);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === ':@') continue;
    const result = findElementAttribute(child, element, attributeName);
    if (result !== null) return result;
  }
  return null;
}

function headingLevelFor(style: string | null): number | null {
  const match = style?.match(/(?:heading|标题)\s*([1-6])/iu);
  return match ? Number(match[1]) : null;
}

function isAlreadyLabelled(content: string): boolean {
  return /^(?:\d+|[A-HＡ-Ｈ]|[一二三四五六七八九十]+)[.、．)）]\s*/u.test(content);
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start));
  } catch (error) {
    throw new MemoryFileParseError('invalid_file', 'TXT must use UTF-8 or UTF-16 encoding', { cause: error });
  }
}

function toBytes(data: MemoryFileInput['data']): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return Uint8Array.from(data);
  return new Uint8Array(data.slice(0));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new MemoryFileParseError('invalid_file', 'SHA-256 is unavailable in this environment');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function normalizedMimeType(kind: MemoryFileKind, mimeType?: string): string {
  if (mimeType?.trim()) return mimeType.toLowerCase().split(';', 1)[0]!.trim();
  if (kind === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (kind === 'pdf') return 'application/pdf';
  return 'text/plain';
}

function formatLocator(name: string, pageStart: number | undefined, pageEnd: number | undefined, sections: string[], questions: string[]): string {
  const parts = [name];
  if (pageStart !== undefined) parts.push(pageStart === pageEnd ? `第 ${pageStart} 页` : `第 ${pageStart}-${pageEnd} 页`);
  if (sections.length) parts.push(sections.join(' / '));
  if (questions.length) parts.push(questions.join('、'));
  return parts.join(' · ');
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MiB` : `${Math.round(bytes / 1024)} KiB`;
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function asObject(value: unknown): Record<string, unknown> | null { return isObject(value) ? value : null; }
function asArray(value: unknown): unknown[] { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }
function attribute(record: Record<string, unknown> | null, name: string): string | null {
  const value = record?.[`@_${name}`];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}
function elementValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const record = asObject(value);
  const attributeValue = record ? Object.entries(record).find(([key]) => key.startsWith('@_'))?.[1] : null;
  return typeof attributeValue === 'string' || typeof attributeValue === 'number' ? String(attributeValue) : null;
}
function toInteger(value: string | null): number | null { return value !== null && /^\d+$/u.test(value) ? Number(value) : null; }
