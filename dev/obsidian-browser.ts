/** Browser stand-in for `obsidian`, used only by the dev harness (same shape as R Board's). */

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.setText = function (this: HTMLElement, t: string) {
  this.textContent = t;
};
proto.addClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.add(...c);
};
proto.removeClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.remove(...c);
};
proto.toggleClass = function (this: HTMLElement, c: string, v: boolean) {
  this.classList.toggle(c, v);
};
proto.empty = function (this: HTMLElement) {
  this.replaceChildren();
};
proto.createEl = function (this: HTMLElement, tag: string, o: { cls?: string; text?: string } = {}) {
  const el = document.createElement(tag);
  if (o.cls) el.className = o.cls;
  if (o.text) el.textContent = o.text;
  this.appendChild(el);
  return el;
};
proto.createDiv = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
  return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('div', o);
};
proto.createSpan = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
  return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('span', o);
};

const mobile = new URLSearchParams(location.search).get('mobile') === '1';
export const Platform = { isMobile: mobile, isPhone: mobile, isDesktop: !mobile };

export class Notice {
  constructor(message: string) {
    (window as unknown as { __log?: string[] }).__log?.push(`[Notice] ${message}`);
    console.info('[Notice]', message);
  }
}

const ICONS: Record<string, string> = {
  list: '☰', search: '⌕', 'chevron-left': '‹', 'chevron-right': '›', 'chevron-up': '▴', 'chevron-down': '▾', 'settings-2': '⚙',
  'trash-2': '🗑', x: '×', 'scroll-text': '📜', clapperboard: '🎬', 'volume-2': '🔊', 'volume-x': '🔇', 'undo-2': '↶',
  'sticky-note': '✎', library: '▦', 'refresh-cw': '↻',
};

/** Fixed-size glyphs, so icon buttons have a stable size in screenshots. */
export function setIcon(el: HTMLElement, name: string): void {
  el.innerHTML = `<svg class="svg-icon" data-icon="${name}" viewBox="0 0 24 24" width="18" height="18"><text x="12" y="17" text-anchor="middle" font-size="16" fill="currentColor">${ICONS[name] ?? '•'}</text></svg>`;
}

export class Modal {
  app: unknown;
  modalEl = document.createElement('div');
  titleEl = document.createElement('h3');
  contentEl = document.createElement('div');
  containerEl = document.createElement('div');
  private bg = this.containerEl;
  constructor(app: unknown) {
    this.app = app;
    this.bg.className = 'dev-modal-bg';
    this.modalEl.className = 'modal dev-modal';
    this.modalEl.append(this.titleEl, this.contentEl);
  }
  open(): void {
    this.bg.appendChild(this.modalEl);
    document.body.appendChild(this.bg);
    this.bg.onclick = (e) => e.target === this.bg && this.close();
    void this.onOpen();
  }
  close(): void {
    this.onClose();
    this.bg.remove();
  }
  onOpen(): void | Promise<void> {}
  onClose(): void {}
}

export class Component {
  private cleanups: (() => void)[] = [];
  load(): void {}
  unload(): void {
    this.cleanups.splice(0).forEach((fn) => fn());
  }
  register(fn: () => void): void {
    this.cleanups.push(fn);
  }
  registerEvent(): void {}
  registerDomEvent(el: EventTarget, type: string, fn: EventListener): void {
    el.addEventListener(type, fn);
    this.register(() => el.removeEventListener(type, fn));
  }
}

/** A workspace view: `containerEl` holding `contentEl`, as in Obsidian. */
class View extends Component {
  app: unknown;
  containerEl = document.createElement('div');
  contentEl = document.createElement('div');
  constructor(public leaf: unknown) {
    super();
    this.containerEl.className = 'workspace-leaf-content';
    this.contentEl.className = 'view-content';
    this.containerEl.appendChild(this.contentEl);
  }
}
export class ItemView extends View {}
export class FileView extends View {
  file: unknown = null;
}

export class TFile {
  stat = { mtime: 1, ctime: 1, size: 1 };
  constructor(public path: string) {}
  get basename() {
    return this.path.split('/').pop()!.replace(/\.[^.]+$/, '');
  }
  get extension() {
    return this.path.split('.').pop()!;
  }
}
export class TFolder {}
export class WorkspaceLeaf {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export const normalizePath = (p: string) => p;
