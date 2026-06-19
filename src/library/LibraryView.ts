import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type RReaderPlugin from '../../main';

export const LIBRARY_VIEW_TYPE = 'r-reader-library';

/** How many books to surface in the "Recently read" row. */
const RECENT_LIMIT = 6;
/** Stable section keys for the non-folder sections (used for collapse state). */
const KEY_RECENT = '__recent';
const KEY_ALL = '__all';

/** A grid of all EPUBs in the vault with covers, progress, and highlight counts. */
export class LibraryView extends ItemView {
  plugin: RReaderPlugin;
  private observer: IntersectionObserver | null = null;
  private bodyEl: HTMLElement | null = null;
  private searchQuery = '';

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

  /** Rebuild the whole view: header, controls, and book sections. */
  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('rr-library-root');

    const header = container.createDiv({ cls: 'rr-library-header' });
    header.createEl('h2', { text: 'Library' });
    const refresh = header.createEl('button', { cls: 'rr-library-refresh', text: 'Refresh' });
    refresh.onclick = () => this.render();

    // Controls: search box + group-by-folder toggle.
    const controls = container.createDiv({ cls: 'rr-library-controls' });
    const search = controls.createEl('input', {
      cls: 'rr-library-search',
      attr: { type: 'search', placeholder: 'Search by title, author, or file…' },
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderBody();
    };

    const groupLabel = controls.createEl('label', { cls: 'rr-library-group' });
    const groupCb = groupLabel.createEl('input', { attr: { type: 'checkbox' } });
    groupCb.checked = this.plugin.settings.libraryGroupByFolder;
    groupCb.onchange = () => {
      this.plugin.settings.libraryGroupByFolder = groupCb.checked;
      void this.plugin.saveSettings();
      this.renderBody();
    };
    groupLabel.createSpan({ text: 'Group by folder' });

    this.bodyEl = container.createDiv({ cls: 'rr-library-body' });
    this.renderBody();
  }

  /** Rebuild only the book sections (recently read + grid), keeping controls. */
  private renderBody(): void {
    const body = this.bodyEl;
    if (!body) return;
    body.empty();

    const all = this.app.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === 'epub');

    if (all.length === 0) {
      body.createDiv({ cls: 'rr-library-empty', text: 'No EPUB files found in this vault.' });
      return;
    }

    const q = this.searchQuery.trim().toLowerCase();
    const files = q
      ? all.filter((f) => f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      : all;

    if (files.length === 0) {
      body.createDiv({ cls: 'rr-library-empty', text: `No books match “${this.searchQuery.trim()}”.` });
      return;
    }

    // Fresh observer for this body render. Look up cards by their data-path.
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          const el = entry.target as HTMLElement;
          const file = el.dataset.path ? all.find((f) => f.path === el.dataset.path) : null;
          if (file) void this.loadCardDetails(file, el);
        }
      },
      { root: this.contentEl, rootMargin: '200px' },
    );

    // Recently read: books with a last-read timestamp, newest first.
    const recent = files
      .filter((f) => this.plugin.progressManager.getLastRead(f.path) != null)
      .sort(
        (a, b) =>
          (this.plugin.progressManager.getLastRead(b.path) ?? 0) -
          (this.plugin.progressManager.getLastRead(a.path) ?? 0),
      )
      .slice(0, RECENT_LIMIT);
    if (recent.length > 0) this.createSection(body, KEY_RECENT, 'Recently read', recent);

    // Main listing: grouped by folder, or one flat grid.
    if (this.plugin.settings.libraryGroupByFolder) {
      const groups = new Map<string, TFile[]>();
      for (const file of files) {
        const folder = file.parent?.path ?? '/';
        const list = groups.get(folder) ?? [];
        list.push(file);
        groups.set(folder, list);
      }
      const folders = [...groups.keys()].sort((a, b) => a.localeCompare(b));
      for (const folder of folders) {
        const list = (groups.get(folder) ?? []).sort((a, b) => a.basename.localeCompare(b.basename));
        this.createSection(body, folder, folder === '/' ? 'Vault root' : folder, list);
      }
    } else {
      const sorted = [...files].sort((a, b) => a.basename.localeCompare(b.basename));
      this.createSection(body, KEY_ALL, 'All books', sorted);
    }
  }

  // ---- collapse state ----------------------------------------------------

  private isCollapsed(key: string): boolean {
    return this.plugin.settings.libraryCollapsed.includes(key);
  }

  private setCollapsed(key: string, collapsed: boolean): void {
    const set = new Set(this.plugin.settings.libraryCollapsed);
    if (collapsed) set.add(key);
    else set.delete(key);
    this.plugin.settings.libraryCollapsed = [...set];
    void this.plugin.saveSettings();
  }

  // ---- rendering ---------------------------------------------------------

  /** A collapsible titled section containing a grid of book cards. */
  private createSection(parent: HTMLElement, key: string, title: string, files: TFile[]): void {
    const section = parent.createDiv({ cls: 'rr-library-section' });
    if (this.isCollapsed(key)) section.addClass('is-collapsed');

    const head = section.createDiv({ cls: 'rr-library-section-head' });
    const chevron = head.createSpan({ cls: 'rr-library-chevron' });
    setIcon(chevron, 'chevron-right');
    head.createSpan({ cls: 'rr-library-section-title', text: title });
    head.createSpan({ cls: 'rr-library-count', text: String(files.length) });
    head.onclick = () => {
      const nowCollapsed = !section.hasClass('is-collapsed');
      section.toggleClass('is-collapsed', nowCollapsed);
      this.setCollapsed(key, nowCollapsed);
    };

    const grid = section.createDiv({ cls: 'rr-library-grid' });
    for (const file of files) this.createCard(file, grid);
  }

  /** Build one book card inside the given grid and observe it for lazy detail loading. */
  private createCard(file: TFile, grid: HTMLElement): void {
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

    this.observer?.observe(card);
  }

  private async openBook(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /** Fill in the cover thumbnail + real title/author from the cover cache. */
  private async loadCardDetails(file: TFile, card: HTMLElement): Promise<void> {
    try {
      const { coverUrl, title, author } = await this.plugin.coverCache.getDetails(file);

      if (coverUrl) {
        const coverEl = card.querySelector<HTMLElement>('.rr-book-cover');
        if (coverEl) {
          coverEl.empty();
          const img = coverEl.createEl('img', {
            cls: 'rr-book-cover-img',
            attr: { src: coverUrl, alt: file.basename },
          });
          img.loading = 'lazy';
        }
      }

      if (title) card.querySelector<HTMLElement>('.rr-book-title')?.setText(title);
      if (author) card.querySelector<HTMLElement>('.rr-book-author')?.setText(author);
    } catch (e) {
      console.error('R Reader: failed to load library card', file.path, e);
    }
  }
}
