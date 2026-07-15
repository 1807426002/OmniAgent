import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { MAX_MEMORY_FILE_BYTES, MemoryFileParseError, parseMemoryFile } from '../src/index.js';

test('TXT parsing keeps complete exam questions and records section/question locators', async () => {
  const first = `1. 第一题题干（ ）\nA. 选项甲\nB. 选项乙\n答案：A\n解析：${'第一题解释。'.repeat(15)}`;
  const second = `2. 第二题题干（ ）\nA. 选项甲\nB. 选项乙\n答案：B\n解析：${'第二题解释。'.repeat(15)}`;
  const parsed = await parseMemoryFile({ name: '题库.txt', type: 'text/plain', data: `# 地理信息安全\n\n${first}\n\n${second}` }, { targetLength: 180 });
  assert.equal(parsed.file.kind, 'txt');
  assert.match(parsed.file.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(parsed.chunks.length, 2);
  assert.ok(parsed.chunks.every((chunk) => chunk.content.includes('答案：')));
  assert.ok(parsed.chunks.every((chunk) => chunk.locator.sections.includes('地理信息安全')));
  assert.deepEqual(parsed.chunks.map((chunk) => chunk.locator.questions[0]), ['第1题', '第2题']);
  assert.equal(parsed.chunks[0]?.content.includes(second.slice(0, 20)), false);
});

test('semantic chunks never split fenced code or table row groups at a fixed length', async () => {
  const code = `\`\`\`ts\n${'const preserved = true;\n'.repeat(50)}\`\`\``;
  const table = `${'列一\t列二\n'.repeat(80)}`.trim();
  const parsed = await parseMemoryFile({ name: '结构.txt', data: `${code}\n\n${table}` }, { targetLength: 100 });
  assert.equal(parsed.chunks.length, 2);
  assert.equal(parsed.chunks[0]?.content, code);
  assert.equal(parsed.chunks[1]?.content, table);
  assert.ok(parsed.chunks.every((chunk) => chunk.content.length > 100));
});

test('DOCX parsing preserves headings, questions, answers, tables, and source metadata', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>必对题</w:t></w:r></w:p>
      <w:p><w:r><w:t>1. DOCX题干（ ）</w:t></w:r></w:p>
      <w:p><w:r><w:t>A. 正确选项</w:t></w:r></w:p>
      <w:p><w:r><w:t>答案：A</w:t></w:r></w:p>
      <w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>题号</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>答案</w:t></w:r></w:p></w:tc>
      </w:tr><w:tr>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>
    </w:body></w:document>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const parsed = await parseMemoryFile({ name: '考试.docx', data: bytes }, { targetLength: 80 });
  assert.equal(parsed.file.kind, 'docx');
  const content = parsed.chunks.map((chunk) => chunk.content).join('\n');
  assert.match(content, /DOCX题干/u);
  assert.match(content, /答案：A/u);
  assert.ok(parsed.units.some((unit) => unit.kind === 'table' && unit.content.includes('题号\t答案')));
  assert.ok(parsed.chunks.some((chunk) => chunk.locator.sections.includes('必对题')));
  assert.ok(parsed.chunks.some((chunk) => chunk.locator.questions.includes('第1题')));
});

test('PDF parsing extracts each page with page locators', async () => {
  const parsed = await parseMemoryFile({ name: 'pages.pdf', type: 'application/pdf', data: makeTwoPagePdf() }, { targetLength: 10 });
  assert.equal(parsed.file.kind, 'pdf');
  const content = parsed.chunks.map((chunk) => chunk.content).join('\n');
  assert.match(content, /Page one memory/u);
  assert.match(content, /Page two memory/u);
  assert.deepEqual([...new Set(parsed.units.map((unit) => unit.locator.page))], [1, 2]);
  assert.ok(parsed.chunks.some((chunk) => chunk.locator.pageStart === 1));
  assert.ok(parsed.chunks.some((chunk) => chunk.locator.pageEnd === 2));
});

test('rejects unsupported, oversized, malformed, and empty files with stable codes', async () => {
  await assert.rejects(parseMemoryFile({ name: 'image.png', data: new Uint8Array([1]) }),
    (error: unknown) => error instanceof MemoryFileParseError && error.code === 'unsupported_type');
  await assert.rejects(parseMemoryFile({ name: 'huge.txt', data: new Uint8Array([1, 2]) }, { maxBytes: 1 }),
    (error: unknown) => error instanceof MemoryFileParseError && error.code === 'file_too_large');
  await assert.rejects(parseMemoryFile({ name: 'broken.docx', data: new Uint8Array([1, 2, 3]) }),
    (error: unknown) => error instanceof MemoryFileParseError && error.code === 'invalid_file');
  await assert.rejects(parseMemoryFile({ name: 'empty.txt', data: '' }),
    (error: unknown) => error instanceof MemoryFileParseError && error.code === 'empty_file');
  assert.equal(MAX_MEMORY_FILE_BYTES, 20 * 1024 * 1024);
});

function makeTwoPagePdf(): Uint8Array {
  const streamOne = 'BT /F1 12 Tf 72 720 Td (Page one memory) Tj ET';
  const streamTwo = 'BT /F1 12 Tf 72 720 Td (Page two memory) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${streamOne.length} >>\nstream\n${streamOne}\nendstream`,
    `<< /Length ${streamTwo.length} >>\nstream\n${streamTwo}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
