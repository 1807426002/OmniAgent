import type {
  BrowserActionResult,
  BrowserElementRef,
  BrowserSnapshot,
  ClickOptions,
  ScrollOptions,
  SnapshotOptions,
  TypeOptions,
} from './types.js';

const REF_ATTR = 'data-omni-ref';

export class BrowserPageController {
  constructor(private readonly doc: Document = document, private readonly win: Window = window) {}

  snapshot(options: SnapshotOptions = {}): BrowserSnapshot {
    const includeText = options.includeText !== false;
    const includeElements = options.includeElements !== false;
    const maxLength = typeof options.maxLength === 'number' ? options.maxLength : 4_000;
    const maxElements = typeof options.maxElements === 'number' ? options.maxElements : 40;
    const selectedText = this.win.getSelection?.()?.toString().trim() ?? '';
    const rawText = includeText
      ? (this.doc.body?.innerText ?? this.doc.documentElement?.innerText ?? '')
      : '';
    const elements = includeElements ? this.collectInteractiveElements(maxElements) : [];
    return {
      url: this.win.location.href,
      title: this.doc.title,
      text: normalizeText(rawText).slice(0, maxLength),
      selectedText,
      elements,
      at: Date.now(),
    };
  }

  click(options: ClickOptions): BrowserActionResult {
    const element = this.resolveElement(options);
    if (!(element instanceof HTMLElement)) throw new Error('Click target was not found');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus();
    element.click();
    return this.result('click', describeElement(element));
  }

  type(options: TypeOptions): BrowserActionResult {
    const value = options.value ?? '';
    if (!value && !options.clear) throw new Error('value is required');
    const element = this.resolveElement({ selector: options.selector, text: options.text, ref: options.ref });
    if (!(element instanceof HTMLElement)) throw new Error('Type target was not found');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus();

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const next = options.clear === false ? `${element.value}${value}` : value;
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, next);
      else element.value = next;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      if (options.submit) {
        element.form?.requestSubmit?.()
          ?? element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    } else if (element.isContentEditable) {
      if (options.clear !== false) element.textContent = '';
      element.textContent = `${element.textContent ?? ''}${value}`;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      throw new Error('Type target is not editable');
    }

    return this.result('type', `${describeElement(element)} <= ${JSON.stringify(value)}`);
  }

  scroll(options: ScrollOptions = {}): BrowserActionResult {
    const direction = options.direction ?? 'down';
    const amount = Math.max(1, options.amount ?? 600);
    const target = options.selector
      ? this.resolveElement({ selector: options.selector })
      : null;

    const delta = {
      up: { x: 0, y: -amount },
      down: { x: 0, y: amount },
      left: { x: -amount, y: 0 },
      right: { x: amount, y: 0 },
    }[direction];

    if (target instanceof HTMLElement) {
      target.scrollBy({ left: delta.x, top: delta.y, behavior: 'instant' as ScrollBehavior });
      return this.result('scroll', `${direction} ${amount}px on ${describeElement(target)}`);
    }

    this.win.scrollBy({ left: delta.x, top: delta.y, behavior: 'instant' as ScrollBehavior });
    return this.result('scroll', `${direction} ${amount}px`);
  }

  private collectInteractiveElements(maxElements: number): BrowserElementRef[] {
    this.clearRefs();
    const candidates = Array.from(
      this.doc.querySelectorAll(
        'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]',
      ),
    );
    const elements: BrowserElementRef[] = [];
    let index = 0;
    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) continue;
      if (!isVisible(element, this.win)) continue;
      const ref = `e${index + 1}`;
      element.setAttribute(REF_ATTR, ref);
      const name = elementText(element).slice(0, 80);
      const tag = element.tagName.toLowerCase();
      elements.push({
        ref,
        tag,
        role: element.getAttribute('role') || defaultRole(element),
        name,
        selector: buildSelector(element),
        href: tag === 'a' ? element.getAttribute('href') ?? undefined : undefined,
        inputType: tag === 'input' ? element.getAttribute('type') ?? 'text' : undefined,
        placeholder:
          tag === 'input' || tag === 'textarea'
            ? (element as HTMLInputElement | HTMLTextAreaElement).placeholder || undefined
            : undefined,
      });
      index += 1;
      if (elements.length >= maxElements) break;
    }
    return elements;
  }

  private clearRefs(): void {
    this.doc.querySelectorAll(`[${REF_ATTR}]`).forEach((element) => {
      element.removeAttribute(REF_ATTR);
    });
  }

  private resolveElement(options: { selector?: string; text?: string; exact?: boolean; ref?: string }): Element {
    const ref = options.ref?.trim();
    if (ref) {
      const byRef = this.doc.querySelector(`[${REF_ATTR}="${cssEscape(ref)}"]`);
      if (!byRef) throw new Error(`No element matches ref: ${ref}`);
      return byRef;
    }

    const selector = options.selector?.trim();
    const text = options.text?.trim();
    if (!selector && !text) throw new Error('selector, text, or ref is required');

    if (selector) {
      const element = this.doc.querySelector(selector);
      if (!element) throw new Error(`No element matches selector: ${selector}`);
      return element;
    }

    const match = findByText(this.doc, text!, options.exact === true);
    if (!match) throw new Error(`No element matches text: ${text}`);
    return match;
  }

  private result(action: string, detail: string): BrowserActionResult {
    return {
      ok: true,
      action,
      detail,
      url: this.win.location.href,
      title: this.doc.title,
    };
  }
}

export function normalizeNavigateUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('url is required');
  if (/^(javascript|data|file|chrome|edge|about):/i.test(trimmed)) {
    throw new Error('Only http/https navigation is allowed');
  }
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : (trimmed.includes('.') && !trimmed.includes(' ') ? `https://${trimmed}` : trimmed);
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http/https navigation is allowed');
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Only http')) throw error;
    throw new Error(`Invalid url: ${url}`);
  }
}

export function normalizeText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findByText(doc: Document, text: string, exact: boolean): Element | null {
  const candidates = Array.from(
    doc.querySelectorAll('a, button, [role="button"], input, textarea, [contenteditable="true"], label, summary'),
  );
  const normalized = text.toLowerCase();
  const scored = candidates
    .map((element) => {
      const content = elementText(element).toLowerCase();
      if (!content) return null;
      if (exact && content === normalized) return { element, score: 100 };
      if (!exact && content.includes(normalized)) return { element, score: 50 + Math.max(0, 20 - Math.abs(content.length - normalized.length)) };
      return null;
    })
    .filter((item): item is { element: Element; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.element ?? null;
}

function elementText(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || element.placeholder || element.getAttribute('aria-label') || '';
  }
  return (element.getAttribute('aria-label') || element.textContent || '').trim();
}

function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const ref = element.getAttribute(REF_ATTR);
  const id = element.id ? `#${element.id}` : '';
  const classes = typeof element.className === 'string' && element.className.trim()
    ? `.${element.className.trim().split(/\s+/u).slice(0, 2).join('.')}`
    : '';
  const text = elementText(element).slice(0, 40);
  return `${ref ? `${ref} ` : ''}${tag}${id}${classes}${text ? ` "${text}"` : ''}`;
}

function isVisible(element: HTMLElement, win: Window): boolean {
  const style = win.getComputedStyle?.(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
  const rect = element.getBoundingClientRect?.();
  if (rect && (rect.width === 0 || rect.height === 0)) return false;
  return true;
}

function defaultRole(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input' || tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  return tag;
}

function buildSelector(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const tag = element.tagName.toLowerCase();
  const name = element.getAttribute('name');
  if (name) return `${tag}[name="${cssEscape(name)}"]`;
  const aria = element.getAttribute('aria-label');
  if (aria) return `${tag}[aria-label="${cssEscape(aria)}"]`;
  const placeholder = (element as HTMLInputElement | HTMLTextAreaElement).placeholder || '';
  if (placeholder) return `${tag}[placeholder="${cssEscape(placeholder)}"]`;
  return tag;
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
