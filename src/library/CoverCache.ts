import { TFile } from 'obsidian';
import type RReaderPlugin from '../../main';
import { makeBook } from '../vendor/foliate-js/view.js';
import { metaAuthor, metaTitle, type BookMeta } from '../util/bookMeta';

/** Longest edge (px) of the persisted thumbnail. Cards are ~140px wide; this
 *  covers retina without keeping the full-res cover (~1400px) in memory. */
const THUMB_MAX = 320;
/** How many EPUBs we'll parse at once on a cold cache (cold-scroll throttle). */
const MAX_CONCURRENT = 3;

interface FoliateBookLite {
  metadata?: BookMeta;
  getCover?: () => Promise<Blob | null>;
}

/** What a card needs: a (thumbnail) cover URL plus the parsed title/author. */
export interface CoverDetails {
  coverUrl: string | null;
  title?: string;
  author?: string;
}

/** On-disk index entry. `sig` ties the cache to a specific file revision so an
 *  edited/replaced EPUB is re-extracted; `thumb` is the cached image filename. */
interface IndexEntry {
  sig: string;
  title?: string;
  author?: string;
  thumb?: string;
}

/**
 * Extracts EPUB covers + metadata for the library, downscales covers to small
 * JPEG thumbnails, and persists both to the plugin folder so books are parsed
 * at most once (per revision) instead of on every session.
 */
export class CoverCache {
  private plugin: RReaderPlugin;
  /** Session map of path → blob object URL (revoked on dispose). */
  private memUrls = new Map<string, string>();
  /** De-dupe concurrent requests for the same file. */
  private inflight = new Map<string, Promise<CoverDetails>>();

  private index: Record<string, IndexEntry> | null = null;
  private indexLoad: Promise<void> | null = null;
  private saveTimer: number | null = null;

  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(plugin: RReaderPlugin) {
    this.plugin = plugin;
  }

  private get dir(): string {
    return `${this.plugin.manifest.dir}/.covers`;
  }
  private get indexPath(): string {
    return `${this.dir}/index.json`;
  }

  /** Cover + metadata for a file, served from disk cache when possible. */
  async getDetails(file: TFile): Promise<CoverDetails> {
    const pending = this.inflight.get(file.path);
    if (pending) return pending;
    const p = this.resolve(file);
    this.inflight.set(file.path, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(file.path);
    }
  }

  /**
   * Force re-extraction of every book's cover + metadata: drop the on-disk
   * index and session object URLs so the next render re-parses each EPUB.
   * Cached thumbnail files are overwritten as books are re-extracted.
   */
  async invalidateAll(): Promise<void> {
    await this.ensureIndex();
    this.index = {};
    for (const url of this.memUrls.values()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    this.memUrls.clear();
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flush();
  }

  private async resolve(file: TFile): Promise<CoverDetails> {
    await this.ensureIndex();
    const index = this.index!;
    const sig = `${file.stat.mtime}-${file.stat.size}`;
    const entry = index[file.path];

    // Disk cache hit (same revision): reuse stored metadata + thumbnail.
    if (entry && entry.sig === sig) {
      const coverUrl = entry.thumb ? await this.urlForThumb(file.path, entry.thumb) : null;
      // If the thumbnail file vanished, fall through to re-extract it.
      if (!entry.thumb || coverUrl) return { coverUrl, title: entry.title, author: entry.author };
    }

    // Miss: parse the EPUB once (throttled), extract + downscale + persist.
    return this.withSlot(() => this.extract(file, sig));
  }

  private async extract(file: TFile, sig: string): Promise<CoverDetails> {
    const buf = await this.plugin.app.vault.readBinary(file);
    const f = new File([buf], file.name, { type: 'application/epub+zip' });
    const book = (await makeBook(f)) as FoliateBookLite;

    let thumbName: string | undefined;
    let coverUrl: string | null = null;
    const blob = book.getCover ? await book.getCover() : null;
    if (blob) {
      const jpeg = await downscaleToJpeg(blob, THUMB_MAX);
      if (jpeg) {
        thumbName = `${hash(file.path)}.jpg`;
        await this.writeThumb(thumbName, jpeg);
        coverUrl = this.makeUrl(file.path, jpeg);
      }
    }

    const title = book.metadata ? metaTitle(book.metadata, '') || undefined : undefined;
    const author = book.metadata ? metaAuthor(book.metadata) : undefined;

    this.index![file.path] = { sig, title, author, thumb: thumbName };
    this.scheduleSave();
    return { coverUrl, title, author };
  }

  // ---- storage helpers -------------------------------------------------

  private async ensureIndex(): Promise<void> {
    if (this.index) return;
    if (!this.indexLoad) {
      this.indexLoad = (async () => {
        try {
          const adapter = this.plugin.app.vault.adapter;
          if (await adapter.exists(this.indexPath)) {
            this.index = JSON.parse(await adapter.read(this.indexPath)) as Record<string, IndexEntry>;
          }
        } catch (e) {
          console.error('R Reader: failed to read cover index', e);
        }
        if (!this.index) this.index = {};
      })();
    }
    await this.indexLoad;
  }

  private async urlForThumb(path: string, thumb: string): Promise<string | null> {
    const cached = this.memUrls.get(path);
    if (cached) return cached;
    try {
      const buf = await this.plugin.app.vault.adapter.readBinary(`${this.dir}/${thumb}`);
      return this.makeUrl(path, buf);
    } catch {
      return null; // thumbnail file missing; will be regenerated next refresh
    }
  }

  private makeUrl(path: string, data: ArrayBuffer): string {
    const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
    this.memUrls.set(path, url);
    return url;
  }

  private async writeThumb(name: string, data: ArrayBuffer): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
      await adapter.writeBinary(`${this.dir}/${name}`, data);
    } catch (e) {
      console.error('R Reader: failed to write cover thumbnail', name, e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 800);
  }

  private async flush(): Promise<void> {
    this.saveTimer = null;
    if (!this.index) return;
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
      await adapter.write(this.indexPath, JSON.stringify(this.index));
    } catch (e) {
      console.error('R Reader: failed to write cover index', e);
    }
  }

  // ---- concurrency throttle (cold cache) -------------------------------

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT) {
      await new Promise<void>((res) => this.waiters.push(res));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  /** Revoke all session object URLs. Called on plugin unload. */
  dispose(): void {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      void this.flush();
    }
    for (const url of this.memUrls.values()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    this.memUrls.clear();
  }
}

// --- module helpers -----------------------------------------------------

/** Draw the cover onto a canvas at a reduced size and encode as JPEG. */
async function downscaleToJpeg(blob: Blob, maxEdge: number): Promise<ArrayBuffer | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
    return out ? await out.arrayBuffer() : null;
  } catch (e) {
    console.error('R Reader: failed to downscale cover', e);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

/** FNV-1a hash → stable short hex string for thumbnail filenames. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
