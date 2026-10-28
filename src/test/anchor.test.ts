// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { captureSelection, findRange, snippet, unwrapById, wrapRange } from '../annotations/anchor';

let root: HTMLElement;

function chapter(html: string, index = 3): HTMLElement {
  document.body.innerHTML = `<div class="rr-chapter" data-index="${index}">${html}</div>`;
  root = document.querySelector('.rr-chapter') as HTMLElement;
  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findRange', () => {
  it('finds a plain quote', () => {
    chapter('<p>The quick brown fox jumps over the lazy dog.</p>');
    const r = findRange(root, { text: 'brown fox', prefix: '', suffix: '' });
    expect(r?.toString()).toBe('brown fox');
  });

  it('returns null for empty or missing text', () => {
    chapter('<p>Hello world</p>');
    expect(findRange(root, { text: '', prefix: 'a', suffix: 'b' })).toBeNull();
    expect(findRange(root, { text: 'absent', prefix: '', suffix: '' })).toBeNull();
  });

  it('uses prefix/suffix to pick the right repeated occurrence', () => {
    chapter('<p>cat sat. dog sat. cat sat on a mat.</p>');
    const r = findRange(root, { text: 'sat', prefix: 'dog ', suffix: '. cat' })!;
    expect(r.startContainer.nodeValue!.slice(r.startOffset - 4, r.startOffset)).toBe('dog ');
  });

  it('degrades to prefix+text, text+suffix, then text alone when context drifted', () => {
    chapter('<p>alpha beta gamma</p>');
    expect(findRange(root, { text: 'beta', prefix: 'alpha ', suffix: 'WRONG' })?.toString()).toBe('beta');
    expect(findRange(root, { text: 'beta', prefix: 'WRONG', suffix: ' gamma' })?.toString()).toBe('beta');
    expect(findRange(root, { text: 'beta', prefix: 'WRONG', suffix: 'WRONG' })?.toString()).toBe('beta');
  });

  it('spans text split across inline elements', () => {
    chapter('<p>one <em>two</em> <b>three</b> four</p>');
    const r = findRange(root, { text: 'two three', prefix: 'one ', suffix: ' four' });
    expect(r?.toString()).toBe('two three');
  });

  it('matches the end of the chapter', () => {
    chapter('<p>start</p><p>the end</p>');
    expect(findRange(root, { text: 'the end', prefix: '', suffix: '' })?.toString()).toBe('the end');
  });
});

describe('wrapRange / unwrapById', () => {
  it('wraps a single-node range in one span', () => {
    chapter('<p>hello big world</p>');
    const r = findRange(root, { text: 'big', prefix: '', suffix: '' })!;
    const spans = wrapRange(r, 'rr-hl', { hlId: 'a' });
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe('big');
    expect(spans[0].dataset.hlId).toBe('a');
    expect(root.textContent).toBe('hello big world');
  });

  it('wraps one span per text node across inline elements', () => {
    chapter('<p>aa <em>bb</em> cc</p>');
    const r = findRange(root, { text: 'a bb c', prefix: '', suffix: '' })!;
    const spans = wrapRange(r, 'rr-hl', { hlId: 'x' });
    expect(spans.map((s) => s.textContent)).toEqual(['a ', 'bb', ' c']);
    expect(root.textContent).toBe('aa bb cc');
  });

  it('unwrap restores the original text and merges nodes', () => {
    chapter('<p>hello big world</p>');
    const before = root.innerHTML;
    wrapRange(findRange(root, { text: 'big', prefix: '', suffix: '' })!, 'rr-hl', { hlId: 'a' });
    expect(root.querySelectorAll('span[data-hl-id="a"]')).toHaveLength(1);
    unwrapById(root, 'a');
    expect(root.querySelectorAll('span[data-hl-id]')).toHaveLength(0);
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('p')!.childNodes).toHaveLength(1);
  });

  it('unwrap only touches the requested id', () => {
    chapter('<p>one two three</p>');
    wrapRange(findRange(root, { text: 'one', prefix: '', suffix: '' })!, 'rr-hl', { hlId: 'a' });
    wrapRange(findRange(root, { text: 'three', prefix: '', suffix: '' })!, 'rr-hl', { hlId: 'b' });
    unwrapById(root, 'a');
    expect(root.querySelector('span[data-hl-id="a"]')).toBeNull();
    expect(root.querySelector('span[data-hl-id="b"]')?.textContent).toBe('three');
  });

  it('highlight text stays findable after wrapping (re-anchoring round trip)', () => {
    chapter('<p>before <em>mid</em>dle after</p>');
    const a = { text: 'mid' + 'dle', prefix: 'before ', suffix: ' after' };
    wrapRange(findRange(root, a)!, 'rr-hl', { hlId: 'h' });
    expect(findRange(root, a)?.toString()).toBe('middle');
  });
});

describe('captureSelection', () => {
  function select(node: Node, s: number, e: number): Selection {
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(node, s);
    r.setEnd(node, e);
    sel.removeAllRanges();
    sel.addRange(r);
    return sel;
  }

  it('captures text, context and chapter index', () => {
    chapter('<p>0123456789 target 0123456789</p>', 7);
    const text = root.querySelector('p')!.firstChild!;
    const q = captureSelection(select(text, 11, 17))!;
    expect(q.text).toBe('target');
    expect(q.chapterIndex).toBe(7);
    expect(q.prefix).toBe('0123456789 ');
    expect(q.suffix).toBe(' 0123456789');
  });

  it('limits context to 40 chars', () => {
    chapter(`<p>${'a'.repeat(100)}X${'b'.repeat(100)}</p>`);
    const q = captureSelection(select(root.querySelector('p')!.firstChild!, 100, 101))!;
    expect(q.prefix).toHaveLength(40);
    expect(q.suffix).toHaveLength(40);
  });

  it('rejects collapsed, whitespace-only, empty and out-of-chapter selections', () => {
    chapter('<p>abc   def</p>');
    const t = root.querySelector('p')!.firstChild!;
    expect(captureSelection(select(t, 1, 1))).toBeNull();
    expect(captureSelection(select(t, 3, 6))).toBeNull();
    window.getSelection()!.removeAllRanges();
    expect(captureSelection(window.getSelection()!)).toBeNull();

    document.body.insertAdjacentHTML('beforeend', '<p id="out">outside text</p>');
    expect(captureSelection(select(document.getElementById('out')!.firstChild!, 0, 7))).toBeNull();
  });

  it('captured quote re-anchors to the same text', () => {
    chapter('<p>one <em>two</em> three</p>');
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(root.querySelector('p')!.firstChild!, 2);
    r.setEnd(root.querySelector('p')!.lastChild!, 3);
    sel.removeAllRanges();
    sel.addRange(r);
    const q = captureSelection(sel)!;
    expect(findRange(root, q)?.toString()).toBe(q.text);
  });
});

describe('snippet', () => {
  const long = 'x'.repeat(100) + 'MATCH' + 'y'.repeat(100);
  it('adds ellipses on both truncated sides', () => {
    const s = snippet(long, 100, 5);
    expect(s.startsWith('… ')).toBe(true);
    expect(s.endsWith(' …')).toBe(true);
    expect(s).toContain('MATCH');
  });
  it('has no ellipsis when the whole text fits', () => {
    expect(snippet('short text here', 6, 4)).toBe('short text here');
  });
  it('collapses whitespace', () => {
    expect(snippet('a \n\n  b\t c', 0, 1)).toBe('a b c');
  });
  it('respects a custom span', () => {
    expect(snippet('0123456789', 5, 1, 2)).toBe('… 34567 …');
  });
});
