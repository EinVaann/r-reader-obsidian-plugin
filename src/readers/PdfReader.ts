import type { PluginSettings } from '../settings/settings';
import type { ProgressManager } from '../reading-progress/ProgressManager';

type PDFDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
  destroy: () => void;
};
type PDFPageProxy = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (ctx: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
  cleanup: () => void;
};

const THEME_BG: Record<string, string> = {
  light: '#ffffff',
  dark: '#1e1e2e',
  sepia: '#f4ecd8',
};

export class PdfReader {
  private container: HTMLElement;
  private scrollEl: HTMLElement;
  private filePath: string;
  private settings: PluginSettings;
  private progress: ProgressManager;
  private pdf: PDFDocumentProxy | null = null;
  private renderTasks: Array<{ cancel: () => void }> = [];
  private observers: IntersectionObserver[] = [];
  private pageEls: HTMLElement[] = [];

  constructor(
    container: HTMLElement,
    filePath: string,
    settings: PluginSettings,
    progress: ProgressManager,
  ) {
    this.container = container;
    this.filePath = filePath;
    this.settings = settings;
    this.progress = progress;

    this.scrollEl = container.createDiv({ cls: 'rr-pdf-scroll' });
  }

  async mount(fileArrayBuffer: ArrayBuffer): Promise<void> {
    const pdfjsLib = await import('pdfjs-dist');
    // Use fake worker (runs on main thread) — avoids bundling/URL issues in Obsidian.
    // For large PDFs the IntersectionObserver strategy limits concurrent work so this stays responsive.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    this.container.addClass('rr-pdf-container');
    this.applyBackground();

    const pdf = await pdfjsLib.getDocument({ data: fileArrayBuffer }).promise;
    this.pdf = pdf as unknown as PDFDocumentProxy;

    const savedPage = this.progress.get(this.filePath);
    const startPage = typeof savedPage === 'number' ? savedPage : 1;

    await this.buildPagePlaceholders(pdf.numPages);
    this.setupScrollTracking(startPage);

    // Scroll to last read page after placeholders are built
    if (startPage > 1 && this.pageEls[startPage - 1]) {
      this.pageEls[startPage - 1].scrollIntoView();
    }
  }

  private applyBackground(): void {
    this.scrollEl.style.background = THEME_BG[this.settings.theme] ?? '#ffffff';
  }

  private async buildPagePlaceholders(numPages: number): Promise<void> {
    // Build placeholder divs; actual rendering is deferred to IntersectionObserver
    for (let i = 1; i <= numPages; i++) {
      const pageWrapper = this.scrollEl.createDiv({ cls: 'rr-pdf-page-wrapper' });
      pageWrapper.dataset.page = String(i);
      this.pageEls.push(pageWrapper);

      const canvas = pageWrapper.createEl('canvas', { cls: 'rr-pdf-canvas' });
      canvas.dataset.rendered = 'false';

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && canvas.dataset.rendered === 'false') {
              canvas.dataset.rendered = 'true';
              this.renderPage(i, canvas);
            }
          }
        },
        { rootMargin: '200px 0px' }, // pre-render ±200px outside viewport
      );
      observer.observe(pageWrapper);
      this.observers.push(observer);
    }
  }

  private async renderPage(pageNum: number, canvas: HTMLCanvasElement): Promise<void> {
    if (!this.pdf) return;
    const page = await this.pdf.getPage(pageNum);
    const scale = Math.min(this.scrollEl.clientWidth / page.getViewport({ scale: 1 }).width, 3);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const task = page.render({ canvasContext: ctx, viewport });
    this.renderTasks.push(task as unknown as { cancel: () => void });
    try {
      await task.promise;
    } catch {
      // render was cancelled — expected on fast scrolling
    }
    page.cleanup();
  }

  private setupScrollTracking(startPage: number): void {
    let ticking = false;
    this.scrollEl.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const midY = this.scrollEl.scrollTop + this.scrollEl.clientHeight / 2;
        for (const el of this.pageEls) {
          if (el.offsetTop + el.clientHeight > midY) {
            const page = Number(el.dataset.page);
            this.progress.save(this.filePath, page);
            break;
          }
        }
      });
    }, { passive: true });

    void startPage; // used above at mount time
  }

  applySettings(settings: PluginSettings): void {
    this.settings = settings;
    this.applyBackground();
  }

  destroy(): void {
    for (const task of this.renderTasks) task.cancel();
    for (const obs of this.observers) obs.disconnect();
    this.pdf?.destroy();
    this.pdf = null;
    this.renderTasks = [];
    this.observers = [];
    this.pageEls = [];
  }
}
