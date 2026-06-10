import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import type RReaderPlugin from '../../main';
import { makeBook } from '../vendor/foliate-js/view.js';
import { metaAuthor, metaTitle, type BookMeta } from '../util/bookMeta';

export const LIBRARY_VIEW_TYPE = 'r-reader-library';

interface FoliateBookLite {
  metadata?: BookMeta;
  getCover?: () => Promise<Blob | null>;
}

/** A grid of all EPUBs in the vault with covers, progress, and highlight counts. */
export class LibraryView extends ItemView {
  plugin: RReaderPlugin;
  private observer: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'R Reader library';
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Re-scan the vault and rebuild the grid. */
  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('rr-library-root');

    const header = container.createDiv({ cls: 'rr-library-header' });
    header.createEl('h2', { text: 'Library' });
    const refresh = header.createEl('button', { cls: 'rr-library-refresh', text: 'Refresh' });
    refresh.onclick = () => this.render();

    const files = this.app.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === 'epub')
      .sort((a, b) => a.basename.localeCompare(b.basename));

    if (files.length === 0) {
      container.createDiv({ cls: 'rr-library-empty', text: 'No EPUB files found in this vault.' });
      return;
    }

    const grid = container.createDiv({ cls: 'rr-library-grid' });

    // Lazily extract covers/metadata as cards scroll into view.
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.observer?.unobserve(entry.target);
            const path = (entry.target as HTMLElement).dataset.path;
            const file = files.find((f) => f.path === path);
            if (file) void this.loadCardDetails(file, entry.target as HTMLElement);
          }
        }
      },
      { root: container, rootMargin: '200px' },
    );

    for (const file of files) {
      const card = grid.createDiv({ cls: 'rr-book-card' });
      card.dataset.path = file.path;
      card.onclick = () => void this.openBook(file);

      const cover = card.createDiv({ cls: 'rr-book-cover' });
      cover.createDiv({ cls: 'rr-book-cover-fallback', text: file.basename });

      const meta = card.createDiv({ cls: 'rr-book-meta' });
      meta.createDiv({ cls: 'rr-book-title', text: file.basename });
      meta.createDiv({ cls: 'rr-book-author', text: '' });

      // Progress bar.
      const saved = this.plugin.progressManager.get(file.path);
      const frac = typeof saved === 'number' ? Math.max(0, Math.min(1, saved)) : 0;
      const bar = card.createDiv({ cls: 'rr-book-progress' });
      bar.createDiv({ cls: 'rr-book-progress-fill' }).style.width = `${frac * 100}%`;

      const footer = card.createDiv({ cls: 'rr-book-footer' });
      footer.createSpan({ cls: 'rr-book-pct', text: frac > 0 ? `${Math.round(frac * 100)}%` : 'Unread' });
      const hl = this.plugin.annotationManager.highlightCount(file.path);
      if (hl > 0) footer.createSpan({ cls: 'rr-book-hl', text: `${hl} ✎` });

      this.observer.observe(card);
    }
  }

  private async openBook(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /** Parse the EPUB to fill in cover image + real title/author. */
  private async loadCardDetails(file: TFile, card: HTMLElement): Promise<void> {
    try {
      // Cover from session cache, or extract + cache.
      let url = this.plugin.coverCache.get(file.path) ?? null;
      let book: FoliateBookLite | null = null;
      if (!url) {
        const buf = await this.app.vault.readBinary(file);
        const f = new File([buf], file.name, { type: 'application/epub+zip' });
        book = (await makeBook(f)) as FoliateBookLite;
        const blob = book.getCover ? await book.getCover() : null;
        if (blob) {
          url = URL.createObjectURL(blob);
          this.plugin.coverCache.set(file.path, url);
        }
      }

      if (url) {
        const coverEl = card.querySelector<HTMLElement>('.rr-book-cover');
        if (coverEl) {
          coverEl.empty();
          const img = coverEl.createEl('img', { cls: 'rr-book-cover-img', attr: { src: url, alt: file.basename } });
          img.loading = 'lazy';
        }
      }

      // Metadata (only available if we parsed the book this pass).
      if (book?.metadata) {
        const title = metaTitle(book.metadata, file.basename);
        const author = metaAuthor(book.metadata);
        const titleEl = card.querySelector<HTMLElement>('.rr-book-title');
        const authorEl = card.querySelector<HTMLElement>('.rr-book-author');
        if (titleEl) titleEl.setText(title);
        if (authorEl && author) authorEl.setText(author);
      }
    } catch (e) {
      console.error('R Reader: failed to load library card', file.path, e);
    }
  }
}
