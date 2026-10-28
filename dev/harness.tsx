/**
 * Dev harness: the real ReaderView / LibraryView in a browser, with a fake
 * `obsidian` and a vault served from `vault/`. Query params pick the scene,
 * e.g. `?view=reader&theme=sepia&mobile=1` (any plugin setting works too).
 */
import { TFile } from 'obsidian';
import { ReaderView } from '../src/ReaderView';
import { LibraryView } from '../src/library/LibraryView';
import { AnnotationManager } from '../src/annotations/AnnotationManager';
import { ProgressManager } from '../src/reading-progress/ProgressManager';
import { createSettingsStore, type ReaderStore, type SettingsStore } from '../src/reader/store';
import { DEFAULT_SETTINGS, type PluginSettings } from '../src/settings/settings';

interface HarnessPlugin {
  settings: PluginSettings;
  settingsStore: SettingsStore;
  progressManager: ProgressManager;
  annotationManager: AnnotationManager;
  /** Number of `persist()` calls (saves to data.json in the real plugin). */
  persisted: number;
  saveSettings(): Promise<void>;
}

declare global {
  interface Window {
    __plugin: HarnessPlugin;
    /** The open book's UI store (null in the library). */
    __store: ReaderStore | null;
    /** Console-style log of actions the fake Obsidian received (open file, notices…). */
    __log: string[];
    /** Set when the scene failed to mount. */
    __error?: string;
  }
}

window.__log = [];
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'reader';
document.body.classList.add(params.get('obsidian') === 'dark' ? 'theme-dark' : 'theme-light');
if (params.get('mobile') === '1') document.body.classList.add('is-mobile');

const BOOK = 'Books/The Harbor Lantern.epub';
const STORY = 'Stories/harbor.ark';
const files = [BOOK, 'Books/Sea Charts.epub', 'Classics/Old Tales.epub', STORY, 'Stories/second.ark'].map(
  (p) => new (TFile as unknown as new (path: string) => TFile)(p),
);
const vaultUrl = (p: string): string => `vault/${p.split('/').map(encodeURIComponent).join('/')}`;
/** Every `.epub` serves the one fixture book; every `.ark` the one story. */
const fixtureFor = (p: string): string => (p.endsWith('.epub') ? BOOK : p.endsWith('.ark') ? STORY : p);

async function fetchOk(p: string): Promise<Response> {
  const res = await fetch(vaultUrl(fixtureFor(p)));
  if (!res.ok) throw new Error(`ENOENT ${p}`);
  return res;
}

let current: ReaderView | LibraryView | null = null;

const app = {
  vault: {
    getFiles: () => files,
    getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
    readBinary: async (f: TFile) => (await fetchOk(f.path)).arrayBuffer(),
    create: async (p: string) => void window.__log.push(`create ${p}`),
    modify: async (f: TFile) => void window.__log.push(`modify ${f.path}`),
    createFolder: async () => {},
    on: () => ({}),
    adapter: {
      read: async (p: string) => (await fetchOk(p)).text(),
      getResourcePath: (p: string) => vaultUrl(p),
    },
  },
  workspace: {
    getLeaf: () => ({ openFile: async (f: TFile) => void window.__log.push(`open ${f.path}`) }),
    getLeavesOfType: () => (current instanceof ReaderView ? [{ view: current }] : []),
  },
};

const settings: PluginSettings = { ...DEFAULT_SETTINGS, storyAssetsFolder: 'Assets', storyNickname: 'Doctor' };
for (const [k, v] of params) {
  if (!(k in settings)) continue;
  const cur = settings[k as keyof PluginSettings];
  (settings as unknown as Record<string, unknown>)[k] = typeof cur === 'number' ? Number(v) : typeof cur === 'boolean' ? v === '1' : v;
}

const plugin = {
  app,
  settings,
  settingsStore: createSettingsStore(settings),
  manifest: { version: '0.0.0-dev', dir: '.obsidian/plugins/r-reader' },
  epubCache: new Map(),
  persisted: 0,
  async persist() {
    this.persisted++;
  },
  async saveSettings() {
    this.settingsStore.setState({ settings: { ...this.settings } });
    if (current instanceof ReaderView) current.refreshSettings();
    await this.persist();
  },
  coverCache: {
    getDetails: async (f: TFile) =>
      f.path === BOOK ? { coverUrl: vaultUrl('cover.svg'), title: 'The Harbor Lantern', author: 'Ada Tester' } : { coverUrl: null },
    invalidateAll: async () => {},
  },
} as unknown as HarnessPlugin;
plugin.progressManager = new ProgressManager(plugin as never);
plugin.annotationManager = new AnnotationManager(plugin as never);
window.__plugin = plugin;

// `?seed=1`: a reader with history — progress, a highlight with a note, a bookmark.
if (params.get('seed') === '1') {
  plugin.progressManager.load({ [BOOK]: 0.42, 'Books/Sea Charts.epub': 1, [STORY]: 0.3 }, { [BOOK]: 2000, 'Books/Sea Charts.epub': 1000, [STORY]: 500 });
  plugin.annotationManager.load({
    [BOOK]: {
      highlights: [
        { id: 'h1', chapterIndex: 0, text: 'Every harbor keeps a secret.', prefix: '', suffix: '', color: 'green', note: 'theme of the book', createdAt: 1 },
      ],
      bookmarks: [{ id: 'b1', chapterIndex: 2, name: 'The lantern', createdAt: 1 }],
    },
  });
}

async function main(): Promise<void> {
  const root = document.getElementById('root')!;
  if (view === 'library') {
    const lib = new LibraryView({} as never, plugin as never);
    Object.assign(lib, { app });
    current = lib;
    root.appendChild(lib.containerEl);
    await lib.onOpen();
    window.__store = null;
    return;
  }
  const rv = new ReaderView({} as never, plugin as never);
  const file = files.find((f) => f.path === (view === 'story' ? STORY : BOOK))!;
  Object.assign(rv, { app, file });
  current = rv;
  root.appendChild(rv.containerEl);
  await rv.onOpen();
  await rv.onLoadFile(file);
  window.__store = (rv as unknown as { store: ReaderStore }).store;
}

main().catch((e) => {
  window.__error = String(e);
  console.error(e);
});
