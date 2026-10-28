// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Notice, TFile, TFolder } from 'obsidian';
import { exportBookNotes } from '../export/exportNotes';
import { openArkBook } from '../readers/ark/arkBook';
import { focusIndex, formatText, mediaId, trackName, renderChapter, type ArkStory } from '../readers/ark/renderChapter';
import { VnScript, parseKey, segKey, compareCursor } from '../readers/ark/vn/script';
import type { BookAnnotations, Highlight } from '../annotations/types';

// The runtime mock's TFile/Notice differ from the real typings.
const TFileMock = TFile as unknown as new (path: string) => TFile;
const TFolderMock = TFolder as unknown as new () => TFolder;
const sent = (Notice as unknown as { messages: string[] }).messages;

/** In-memory vault covering what exportNotes and arkBook touch. */
function fakeApp(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  const folders = new Set<string>();
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (folders.has(p)) return Object.assign(new TFolderMock(),{ path: p });
        return store.has(p) ? new TFileMock(p) : null;
      },
      createFolder: async (p: string) => void folders.add(p),
      create: async (p: string, d: string) => void store.set(p, d),
      modify: async (f: TFile, d: string) => void store.set(f.path, d),
      adapter: {
        read: async (p: string) => {
          if (!store.has(p)) throw new Error(`ENOENT ${p}`);
          return store.get(p)!;
        },
        getResourcePath: (p: string) => `app://vault/${p}`,
      },
    },
  };
  return { app: app as never, store, folders };
}

const hl = (id: string, o: Partial<Highlight> = {}): Highlight => ({
  id, chapterIndex: 0, text: id, prefix: '', suffix: '', color: 'yellow', createdAt: 0, ...o,
});

describe('exportBookNotes', () => {
  beforeEach(() => void (sent.length = 0));
  const toc = [
    { label: 'Intro', index: 0 },
    { label: 'Part Two', index: 2 },
  ] as never;

  it('writes a note with header, source link, grouped highlights and bookmarks', async () => {
    const { app, store, folders } = fakeApp();
    const ann: BookAnnotations = {
      highlights: [
        hl('late', { chapterIndex: 2, createdAt: 5, color: 'pink', note: ' my note ' }),
        hl('first', { chapterIndex: 0, createdAt: 1 }),
        hl('second', { chapterIndex: 0, createdAt: 2, text: 'line1\nline2' }),
      ],
      bookmarks: [{ id: 'b', chapterIndex: 2, name: 'Mark', createdAt: 1 }],
    };
    const path = await exportBookNotes(app, new TFileMock('Books/Dune.epub'), ann, toc, { title: ' Dune ', author: 'Herbert' }, 'Notes');
    expect(path).toBe('Notes/Dune.md');
    expect(folders.has('Notes')).toBe(true);
    const md = store.get('Notes/Dune.md')!;
    expect(md).toContain('# Dune');
    expect(md).toContain('*by Herbert*');
    expect(md).toContain('[[Books/Dune.epub|Dune]]');
    expect(md.indexOf('### Intro')).toBeLessThan(md.indexOf('### Part Two'));
    expect(md.indexOf('> first')).toBeLessThan(md.indexOf('> line1'));
    expect(md).toContain('> line1\n> line2');
    expect(md).toContain('> [!quote] Pink\n> late\n\nmy note');
    expect(md).toContain('> [!quote]\n> first');
    expect(md).toContain('- **Mark** — Part Two');
    expect(sent.at(-1)).toContain('Notes/Dune.md');
  });

  it('falls back to file name and numbered chapters; empty state message', async () => {
    const { app, store } = fakeApp();
    await exportBookNotes(app, new TFileMock('x/Book.epub'), { highlights: [hl('h', { chapterIndex: 4 })], bookmarks: [] }, [], {}, '');
    const md = store.get('Book.md')!;
    expect(md).toContain('# Book');
    expect(md).not.toContain('*by');
    expect(md).toContain('### Chapter 5');

    await exportBookNotes(app, new TFileMock('x/Empty.epub'), { highlights: [], bookmarks: [] }, [], {}, '');
    expect(store.get('Empty.md')).toContain('*No highlights or bookmarks yet.*');
  });

  it('overwrites an existing note instead of failing', async () => {
    const { app, store } = fakeApp({ 'N/B.md': 'old' });
    await exportBookNotes(app, new TFileMock('B.epub'), { highlights: [hl('new')], bookmarks: [] }, [], {}, 'N');
    expect(store.get('N/B.md')).toContain('> new');
    expect(store.get('N/B.md')).not.toContain('old');
  });
});

const STORY: ArkStory = {
  format: 'ark', version: 1, eventId: 'e', eventName: 'Event Name',
  chapters: [
    { id: 'c0', title: 'One', nodes: [{ nodeId: 'n0', segments: [{ segment_type: 'narration', text: 'Hi {@nickname}' }] }] },
    { id: 'c1', title: 'Two', nodes: [{ nodeId: 'n1', segments: [{ segment_type: 'narration', text: 'Bye' }] }] },
  ],
};

describe('openArkBook', () => {
  const opts = { nickname: 'Dr', assetsFolder: 'Assets' };

  it('exposes chapters as sections, toc and metadata', async () => {
    const { app } = fakeApp({ 'S/story.ark': JSON.stringify(STORY), 'Assets/media.json': '{}' });
    const { book, story } = await openArkBook(app, new TFileMock('S/story.ark'), opts);
    expect(story.eventName).toBe('Event Name');
    expect(book.sections).toHaveLength(2);
    expect(book.toc).toEqual([{ label: 'One', href: 'ch0' }, { label: 'Two', href: 'ch1' }]);
    expect(book.metadata).toEqual({ title: 'Event Name' });
    expect(book.resolveHref?.('ch1#x')).toEqual({ index: 1 });
    expect(book.resolveHref?.('nope')).toBeNull();
    const doc = await book.sections[0].createDocument();
    expect(doc.body.textContent).toContain('Hi Dr');
  });

  it('title falls back to the file basename', async () => {
    const { app } = fakeApp({ 'S/story.ark': JSON.stringify({ ...STORY, eventName: '' }) });
    const { book } = await openArkBook(app, new TFileMock('S/story.ark'), { ...opts, assetsFolder: 'Missing' });
    expect(book.metadata?.title).toBe('story');
  });

  it('rejects non-ark files', async () => {
    const bad = fakeApp({ 'a.ark': JSON.stringify({ format: 'x', chapters: [] }), 'b.ark': JSON.stringify({ format: 'ark' }), 'c.ark': 'not json' });
    await expect(openArkBook(bad.app, new TFileMock('a.ark'), opts)).rejects.toThrow(/Not an .ark story/);
    await expect(openArkBook(bad.app, new TFileMock('b.ark'), opts)).rejects.toThrow(/Not an .ark story/);
    await expect(openArkBook(bad.app, new TFileMock('c.ark'), opts)).rejects.toThrow();
  });

  it('resolves media through media.json and hides missing assets', async () => {
    const media = {
      'bg:room': { status: 'ok', local_path: 'bg/room.png' },
      'bg:gone': { status: 'missing', local_path: 'bg/gone.png' },
      'bg:nopath': {},
    };
    const { app } = fakeApp({ 'S/s.ark': JSON.stringify(STORY), 'Assets2/media.json': JSON.stringify(media) });
    const { resolve } = await openArkBook(app, new TFileMock('S/s.ark'), { ...opts, assetsFolder: 'Assets2' });
    expect(resolve('bg:room')).toBe('app://vault/Assets2/bg/room.png');
    expect(resolve('bg:gone')).toBeNull();
    expect(resolve('bg:nopath')).toBeNull();
    expect(resolve('unknown')).toBeNull();
  });

  it('survives an unreadable media table (text only)', async () => {
    const { app } = fakeApp({ 'S/s.ark': JSON.stringify(STORY) });
    const { resolve } = await openArkBook(app, new TFileMock('S/s.ark'), { ...opts, assetsFolder: 'NoTable' });
    expect(resolve('bg:x')).toBeNull();
  });
});

describe('ark text helpers', () => {
  it('formatText escapes html and keeps allowed tags', () => {
    expect(formatText('<script>x</script>', 'N')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(formatText('<i>a</i> <b>b</b>', 'N')).toBe('<i>a</i> <b>b</b>');
    expect(formatText('a<br/>b\\nc\nd', 'N')).toBe('a<br>b<br>c<br>d');
    expect(formatText('<color=#fff>x</color>', 'N')).toBe('x');
    expect(formatText('{@nbs}', 'N')).toBe('&nbsp;');
  });
  it('formatText fills the nickname safely, case-insensitively', () => {
    expect(formatText('{@NICKNAME}', '<b>')).toBe('<span class="rr-ark-nick">&lt;b&gt;</span>');
  });
  it('trackName strips loop/intro suffixes', () => {
    expect(trackName('$babel_loop')).toBe('$babel');
    expect(trackName('$babel_INTRO')).toBe('$babel');
    expect(trackName('plain')).toBe('plain');
  });
  it('mediaId prefers the explicit table, then builds from kind:name', () => {
    expect(mediaId({ segment_type: 'dialogue', media: { f: 'music:x' } }, 'f', 'bg', 'y')).toBe('music:x');
    expect(mediaId({ segment_type: 'dialogue' }, 'f', 'bg', 'y')).toBe('bg:y');
    expect(mediaId({ segment_type: 'dialogue' }, 'f', 'bg', '')).toBeNull();
    expect(mediaId({ segment_type: 'dialogue' }, 'f', 'bg', 5)).toBeNull();
  });
  it('focusIndex handles all spellings', () => {
    expect([1, '1', 'L', 'left'].map(focusIndex)).toEqual([0, 0, 0, 0]);
    expect([2, '2', 'r', 'RIGHT'].map(focusIndex)).toEqual([1, 1, 1, 1]);
    expect([undefined, '', 'both', 3].map(focusIndex)).toEqual([null, null, null, null]);
  });
});

describe('renderChapter edge cases', () => {
  const none = () => null;
  it('empty chapter renders an empty section', () => {
    expect(renderChapter({ id: 'c', title: 'T', nodes: [] }, none, 'N')).toBe('<section class="rr-ark-chapter"></section>');
  });
  it('escapes the title and node tags', () => {
    const html = renderChapter(
      { id: 'c', title: '<b>T</b>', nodes: [{ nodeId: 'n"', avgTag: 'A&B', segments: [] }, { nodeId: 'q"1', avgTag: 'X<', segments: [] }] },
      none,
      'N',
    );
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('id="q&quot;1"');
  });
  it('dialogue without text is dropped', () => {
    const html = renderChapter({ id: 'c', title: 'T', nodes: [{ nodeId: 'n', segments: [{ segment_type: 'dialogue', speaker: 'X' }] }] }, none, 'N');
    expect(html).not.toContain('rr-ark-line');
  });
  it('stopmusic leaves an invisible marker without ending a branch', () => {
    const html = renderChapter(
      {
        id: 'c', title: 'T',
        nodes: [{
          nodeId: 'n',
          segments: [
            { segment_type: 'choice', choices: [{ text: 'a', value: '1' }, { text: 'b', value: '2' }] },
            { segment_type: 'stage_direction', action: 'stopmusic' },
            { segment_type: 'dialogue', speaker: 'S', text: 'in branch', choice_values: ['1'] },
          ],
        }],
      },
      none,
      'N',
    );
    expect(html).toContain('rr-ark-music-stop');
    expect(html).toMatch(/rr-ark-branch[^>]*data-values="1"/);
  });
  it('seg keys carry the chapter index', () => {
    const html = renderChapter({ id: 'c', title: 'T', nodes: [{ nodeId: 'n', segments: [{ segment_type: 'narration', text: 'x' }] }] }, none, 'N', 7);
    expect(html).toContain('data-seg="7:0:0"');
  });
});

describe('vn cursor helpers', () => {
  it('segKey / parseKey round-trip and reject garbage', () => {
    const c = { chapter: 1, node: 2, seg: -1 };
    expect(parseKey(segKey(c))).toEqual(c);
    for (const bad of ['', 'a:b:c', '1:2', '1:2:3:4', '1:-2:3']) expect(parseKey(bad)).toBeNull();
  });
  it('compareCursor orders chapter, node, seg', () => {
    const k = (chapter: number, node: number, seg: number) => ({ chapter, node, seg });
    expect(compareCursor(k(0, 5, 5), k(1, 0, 0))).toBeLessThan(0);
    expect(compareCursor(k(1, 1, 0), k(1, 0, 9))).toBeGreaterThan(0);
    expect(compareCursor(k(1, 1, 2), k(1, 1, 2))).toBe(0);
  });
});

describe('VnScript edge cases', () => {
  const mk = (segments: ArkStory['chapters'][0]['nodes'][0]['segments'][]): ArkStory => ({
    ...STORY,
    chapters: segments.map((s, i) => ({ id: `c${i}`, title: `C${i}`, nodes: [{ nodeId: `n${i}`, segments: s }] })),
  });

  it('empty story has no frames', () => {
    const v = new VnScript({ ...STORY, chapters: [] });
    const { next, run } = v.chapterStart(0);
    expect(v.next(next, run, new Map())).toBeNull();
  });

  it('reaches the end of the story: title, line, title, line, null', () => {
    const v = new VnScript(STORY);
    let { next, run } = v.chapterStart(0);
    const kinds: string[] = [];
    for (let s = v.next(next, run, new Map()); s; s = v.next(next, run, new Map())) {
      kinds.push(s.frame.stop.kind);
      ({ next, run } = s);
    }
    expect(kinds).toEqual(['title', 'line', 'title', 'line']);
  });

  it('a chosen option overrides the default and the other branch is skipped', () => {
    const story = mk([[
      { segment_type: 'choice', speaker: 'Dr', choices: [{ text: 'a', value: '1' }, { text: 'b', value: '2' }] },
      { segment_type: 'dialogue', speaker: 'S', text: 'one', choice_values: ['1'] },
      { segment_type: 'dialogue', speaker: 'S', text: 'two', choice_values: ['2'] },
      { segment_type: 'dialogue', speaker: 'S', text: 'after' },
    ]]);
    const run = (choices: Map<string, string>) => {
      const v = new VnScript(story);
      let { next, run: r } = v.chapterStart(0);
      const texts: string[] = [];
      for (let s = v.next(next, r, choices); s; s = v.next(next, r, choices)) {
        if (s.frame.stop.kind === 'line') texts.push(s.frame.stop.text);
        ({ next, run: r } = s);
      }
      return texts;
    };
    expect(run(new Map())).toEqual(['one', 'after']);
    expect(run(new Map([['0:0', '2']]))).toEqual(['two', 'after']);
  });

  it('dialogue with no text and unknown directions never stop', () => {
    const v = new VnScript(mk([[
      { segment_type: 'dialogue', speaker: 'X' },
      { segment_type: 'stage_direction', action: 'Shake', params: {} },
      { segment_type: 'narration', text: 'real' },
    ]]));
    const { next, run } = v.chapterStart(0);
    const title = v.next(next, run, new Map())!;
    const line = v.next(title.next, title.run, new Map())!;
    expect(line.frame.stop).toMatchObject({ kind: 'line', text: 'real', narration: true });
    expect(line.frame.key).toBe('0:0:2');
  });

  it('stage tracks bg/cg/music, clears on empty image, stopmusic and new chapter', () => {
    const v = new VnScript(mk([
      [
        { segment_type: 'stage_direction', action: 'Background', params: { image: 'room' } },
        { segment_type: 'stage_direction', action: 'Image', params: { image: 'cg1' } },
        { segment_type: 'stage_direction', action: 'PlayMusic', params: { key: 'song' } },
        { segment_type: 'narration', text: 'a' },
        { segment_type: 'stage_direction', action: 'Image', params: {} },
        { segment_type: 'stage_direction', action: 'StopMusic' },
        { segment_type: 'narration', text: 'b' },
      ],
      [{ segment_type: 'narration', text: 'c' }],
    ]));
    const stages: unknown[] = [];
    let { next, run } = v.chapterStart(0);
    for (let s = v.next(next, run, new Map()); s; s = v.next(next, run, new Map())) {
      if (s.frame.stop.kind === 'line') stages.push(s.frame.stage);
      ({ next, run } = s);
    }
    expect(stages).toEqual([
      { bg: 'bg:room', cg: 'cgs:cg1', music: 'music:song' },
      { bg: 'bg:room', cg: null, music: null },
      { bg: null, cg: null, music: null },
    ]);
  });

  it('replayTo returns history up to and including the target', () => {
    const v = new VnScript(STORY);
    const steps = v.replayTo({ chapter: 1, node: 0, seg: 0 }, new Map());
    expect(steps.map((s) => s.frame.key)).toEqual(['1:0:-1', '1:0:0']);
    const all = v.replayTo({ chapter: 0, node: 99, seg: 0 }, new Map());
    expect(all.length).toBeGreaterThan(0);
  });
});
