import { Platform } from 'obsidian';

type CapacitorApp = {
  addListener: (event: string, cb: () => void) => { remove: () => void };
};

export class MobileControls {
  private container: HTMLElement;
  private removeVolUp?: () => void;
  private removeVolDown?: () => void;
  private touchStartY = 0;
  private touchStartX = 0;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    if (Platform.isMobile) {
      this.setupVolumeKeys();
      this.setupTouchZones();
    }
  }

  unmount(): void {
    this.removeVolUp?.();
    this.removeVolDown?.();
  }

  private setupVolumeKeys(): void {
    const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: CapacitorApp } } }).Capacitor;
    const app = cap?.Plugins?.App;
    if (!app) return;

    const upHandle = app.addListener('volumeUpButton', () => {
      this.container.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
    });
    const downHandle = app.addListener('volumeDownButton', () => {
      this.container.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
    });

    this.removeVolUp = () => upHandle.remove();
    this.removeVolDown = () => downHandle.remove();
  }

  private setupTouchZones(): void {
    this.container.addEventListener('touchstart', (e) => {
      this.touchStartY = e.touches[0].clientY;
      this.touchStartX = e.touches[0].clientX;
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      const dy = e.changedTouches[0].clientY - this.touchStartY;
      const dx = e.changedTouches[0].clientX - this.touchStartX;
      // Only handle taps (small movement), not swipes
      if (Math.abs(dy) > 10 || Math.abs(dx) > 10) return;

      const y = e.changedTouches[0].clientY;
      const zone = window.innerHeight / 3;

      if (y < zone) {
        this.container.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
      } else if (y > zone * 2) {
        this.container.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
      }
      // Middle third: no scroll (could toggle UI chrome here)
    }, { passive: true });
  }
}
