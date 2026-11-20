/**
 * Text-quote anchoring: locate a previously-saved highlight in re-rendered DOM
 * without CFI, robust to text split across inline elements.
 *
 * Key invariant: the chapters have had <script>/<style> stripped at render time,
 * so the concatenation of text-node `nodeValue`s equals `Range.toString()` over
 * the same span. We use that to convert between DOM positions and flat offsets.
 */

const CONTEXT = 40; // chars of prefix/suffix captured for re-anchoring

export interface QuoteAnchor {
  chapterIndex: number;
  text: string;
  prefix: string;
  suffix: string;
}

interface TextMap {
  text: string;
  segments: { node: Text; start: number }[];
}

/** Build a flat text string for `root` plus a map back to its text nodes. */
function buildTextMap(root: Node): TextMap {
  const segments: { node: Text; start: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    segments.push({ node: tn, start: text.length });
    text += tn.nodeValue ?? '';
  }
  return { text, segments };
}

/** Flat char offset of (container, offset) measured from the start of `root`. */
function flatOffset(root: Element, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(container, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

/** Find the text node + local offset that contains a flat offset. */
function segAt(map: TextMap, offset: number, preferEnd: boolean): { node: Text; local: number } | null {
  for (let i = 0; i < map.segments.length; i++) {
    const s = map.segments[i];
    const len = s.node.length;
    const within = preferEnd ? offset > s.start && offset <= s.start + len
                             : offset >= s.start && offset < s.start + len;
    if (within) return { node: s.node, local: offset - s.start };
  }
  // Fall back to the last segment's end (covers offset == total length).
  const last = map.segments[map.segments.length - 1];
  if (last) return { node: last.node, local: last.node.length };
  return null;
}

function rangeFromOffsets(map: TextMap, start: number, end: number): Range | null {
  const a = segAt(map, start, false);
  const b = segAt(map, end, true);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.local);
  range.setEnd(b.node, b.local);
  return range;
}

/** Locate a quote within a chapter element; returns a live Range or null. */
export function findRange(chapterEl: Element, anchor: Pick<QuoteAnchor, 'text' | 'prefix' | 'suffix'>): Range | null {
  const { text, prefix, suffix } = anchor;
  if (!text) return null;
  const map = buildTextMap(chapterEl);

  const tryAt = (needle: string, textOffset: number): Range | null => {
    const idx = map.text.indexOf(needle);
    if (idx < 0) return null;
    const start = idx + textOffset;
    return rangeFromOffsets(map, start, start + text.length);
  };

  return (
    tryAt(prefix + text + suffix, prefix.length) ??
    tryAt(prefix + text, prefix.length) ??
    tryAt(text + suffix, 0) ??
    tryAt(text, 0)
  );
}

function textNodesInRange(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (range.intersectsNode(n)) out.push(n as Text);
  }
  return out;
}

/**
 * Wrap the text covered by `range` in <span> elements (one per text node it
 * crosses). Returns the created spans. Handles ranges that span multiple inline
 * elements, which Range.surroundContents cannot.
 */
export function wrapRange(range: Range, className: string, dataset: Record<string, string>): HTMLElement[] {
  const nodes = textNodesInRange(range);
  const spans: HTMLElement[] = [];
  for (const node of nodes) {
    const s = node === range.startContainer ? range.startOffset : 0;
    const e = node === range.endContainer ? range.endOffset : node.length;
    if (s >= e) continue;
    let target = node;
    if (e < target.length) target.splitText(e);
    if (s > 0) target = target.splitText(s);
    const span = document.createElement('span');
    span.className = className;
    for (const [k, v] of Object.entries(dataset)) span.dataset[k] = v;
    target.parentNode?.insertBefore(span, target);
    span.appendChild(target);
    spans.push(span);
  }
  return spans;
}

/** Remove highlight spans with a given data-hl-id, restoring the text. */
export function unwrapById(root: ParentNode, id: string): void {
  root.querySelectorAll<HTMLElement>(`span[data-hl-id="${CSS.escape(id)}"]`).forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}

function closestChapter(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (el?.closest('.rr-chapter') as HTMLElement) ?? null;
}

/** Build a QuoteAnchor from a live Selection, or null if it isn't usable. */
export function captureSelection(sel: Selection): QuoteAnchor | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const chapterEl = closestChapter(range.commonAncestorContainer);
  if (!chapterEl) return null;

  const map = buildTextMap(chapterEl);
  const start = flatOffset(chapterEl, range.startContainer, range.startOffset);
  const end = flatOffset(chapterEl, range.endContainer, range.endOffset);
  if (end <= start) return null;

  const text = map.text.slice(start, end);
  if (!text.trim()) return null;

  return {
    chapterIndex: Number(chapterEl.dataset.index),
    text,
    prefix: map.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: map.text.slice(end, end + CONTEXT),
  };
}

/** A trimmed context string around a match, for search result rows. */
export function snippet(text: string, matchIndex: number, matchLen: number, span = 60): string {
  const from = Math.max(0, matchIndex - span);
  const to = Math.min(text.length, matchIndex + matchLen + span);
  let s = text.slice(from, to).replace(/\s+/g, ' ').trim();
  if (from > 0) s = '… ' + s;
  if (to < text.length) s = s + ' …';
  return s;
}
