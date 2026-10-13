import { normalizePath, type App, type TFile } from 'obsidian';
import type { FoliateBook, FoliateSection } from '../EpubReader';
import { renderChapter, type ArkStory, type MediaResolver } from './renderChapter';

interface MediaEntry {
  status?: string;
  local_path?: string;
}

/** Parsed media tables, keyed by vault path (shared by every story using that assets folder). */
const mediaTables = new Map<string, Promise<Record<string, MediaEntry>>>();

async function readJson<T>(app: App, path: string): Promise<T> {
  return JSON.parse(await app.vault.adapter.read(path)) as T;
}

function loadMediaTable(app: App, path: string): Promise<Record<string, MediaEntry>> {
  let table = mediaTables.get(path);
  if (!table) {
    table = readJson<Record<string, MediaEntry>>(app, path).catch((e) => {
      mediaTables.delete(path); // retry on the next open
      throw e;
    });
    mediaTables.set(path, table);
  }
  return table;
}

/** Media ID → vault resource URL, via `media.json` in the assets folder. */
async function makeResolver(app: App, assetsFolder: string): Promise<MediaResolver> {
  const tablePath = normalizePath(`${assetsFolder}/media.json`);
  let table: Record<string, MediaEntry> = {};
  try {
    table = await loadMediaTable(app, tablePath);
  } catch (e) {
    console.warn(`R Reader: no media table at ${tablePath}; showing text only`, e);
  }
  return (id) => {
    const entry = table[id];
    if (!entry?.local_path || entry.status === 'missing') return null;
    return app.vault.adapter.getResourcePath(normalizePath(`${assetsFolder}/${entry.local_path}`));
  };
}

function section(render: () => Promise<string>): FoliateSection {
  return {
    createDocument: async () =>
      new DOMParser().parseFromString(`<!doctype html><html><body>${await render()}</body></html>`, 'text/html'),
  };
}

/** An opened story: the book the script view renders, plus what the visual-novel view needs. */
export interface ArkOpened {
  book: FoliateBook;
  story: ArkStory;
  resolve: MediaResolver;
}

/**
 * Open a `.ark` story as a book: its chapters in order, one TOC entry each.
 * Media comes from `assetsFolder` (the stories' "Assets folder" setting).
 */
export async function openArkBook(app: App, file: TFile, opts: { nickname: string; assetsFolder: string }): Promise<ArkOpened> {
  const data = await readJson<Partial<ArkStory>>(app, file.path);
  if (data.format !== 'ark' || !Array.isArray(data.chapters)) {
    throw new Error('Not an .ark story: expected "format": "ark" with a "chapters" list');
  }
  const story = data as ArkStory;
  const { nickname } = opts;
  const resolve = await makeResolver(app, opts.assetsFolder);
  const book: FoliateBook = {
    sections: story.chapters.map((ch, i) => section(async () => renderChapter(ch, resolve, nickname, i))),
    toc: story.chapters.map((ch, i) => ({ label: ch.title, href: `ch${i}` })),
    metadata: { title: story.eventName || file.basename },
    resolveHref: (href) => {
      const m = /^ch(\d+)/.exec(href);
      return m ? { index: Number(m[1]) } : null;
    },
  };
  return { book, story, resolve };
}
