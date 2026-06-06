import { Platform } from 'obsidian';

type CapacitorApp = {
  addListener: (event: string, cb: () => void) => { remove: () => void };
};

/**
 * Mobile reading controls: volume-key page turns and tap zones.
 * All navigation is routed through the onNavigate callback so it works
 * for both scrollable (PDF) and paginated (EPUB) readers.
 */
export class MobileControls {
  private el: HTMLElement;
  private onNavigate: (dir: 1 | -1) => void;
  private removeVolUp?: () => void;
  private removeVolDown?: () => void;
  private touchStartY = 0;
  private touchStartX = 0;
  private touchHandlerStart?: (e: TouchEvent) => void;
  private touchHandlerEnd?: (e: TouchEvent) => void;

  constructor(el: HTMLElement, onNavigate: (dir: 1 | -1) => void) {
    this.el = el;
    this.onNavigate = onNavigate;
  }

  mount(): void {
    if (!Platform.isMobile) return;
    this.setupVolumeKeys();
    this.setupTouchZones();
  }

  unmount(): void {
    this.removeVolUp?.();
    this.removeVolDown?.();
    if (this.touchHandlerStart) this.el.removeEventListener('touchstart', this.touchHandlerStart);
    if (this.touchHandlerEnd) this.el.removeEventListener('touchend', this.touchHandlerEnd);
  }

  private setupVolumeKeys(): void {
    const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: CapacitorApp } } }).Capacitor;
    const app = cap?.Plugins?.App;
    if (!app) return;

    const upHandle = app.addListener('volumeUpButton', () => this.onNavigate(-1));
    const downHandle = app.addListener('volumeDownButton', () => this.onNavigate(1));
    this.removeVolUp = () => upHandle.remove();
    this.removeVolDown = () => downHandle.remove();
  }

  private setupTouchZones(): void {
    this.touchHandlerStart = (e: TouchEvent) => {
      this.touchStartY = e.touches[0].clientY;
      this.touchStartX = e.touches[0].clientX;
    };
    this.touchHandlerEnd = (e: TouchEvent) => {
      const dy = e.changedTouches[0].clientY - this.touchStartY;
      const dx = e.changedTouches[0].clientX - this.touchStartX;
      // Only treat as a tap (ignore swipes / normal scrolling)
      if (Math.abs(dy) > 10 || Math.abs(dx) > 10) return;

      const rect = this.el.getBoundingClientRect();
      const relY = e.changedTouches[0].clientY - rect.top;
      const zone = rect.height / 3;

      if (relY < zone) this.onNavigate(-1);
      else if (relY > zone * 2) this.onNavigate(1);
      // Middle third: reserved for toggling UI chrome later
    };

    this.el.addEventListener('touchstart', this.touchHandlerStart, { passive: true });
    this.el.addEventListener('touchend', this.touchHandlerEnd, { passive: true });
  }
}
