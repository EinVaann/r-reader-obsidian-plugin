/**
 * A minimal stand-in for the `obsidian` module (which only ships types), so
 * the React UI can be rendered under happy-dom in tests. Only what the plugin
 * touches is implemented, and only as far as rendering needs.
 */

// Obsidian's HTMLElement helpers.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.empty = function (this: HTMLElement) {
  while (this.firstChild) this.removeChild(this.firstChild);
};
proto.addClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.add(...c);
};
proto.removeClass = function (this: HTMLElement, ...c: string[]) {
  this.classList.remove(...c);
};
proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) {
  this.classList.toggle(c, on);
};
proto.setText = function (this: HTMLElement, t: string) {
  this.textContent = t;
};
proto.createEl = function (this: HTMLElement, tag: string, o: { cls?: string; text?: string } = {}) {
  const el = document.createElement(tag);
  if (o.cls) el.className = o.cls;
  if (o.text) el.textContent = o.text;
  this.appendChild(el);
  return el;
};
proto.createDiv = function (this: HTMLElement, o?: object) {
  return (this as unknown as { createEl: (t: string, o?: object) => HTMLElement }).createEl('div', o);
};
proto.createSpan = function (this: HTMLElement, o?: object) {
  return (this as unknown as { createEl: (t: string, o?: object) => HTMLElement }).createEl('span', o);
};

export const icons: string[] = [];
export function setIcon(el: HTMLElement, name: string): void {
  icons.push(name);
  el.innerHTML = `<svg data-icon="${name}"></svg>`;
}

export class Component {
  loaded = false;
  load(): void {
    this.loaded = true;
  }
  unload(): void {
    this.loaded = false;
  }
}

export const MarkdownRenderer = {
  render: async (_app: unknown, md: string, el: HTMLElement) => {
    el.appendChild(document.createTextNode(md));
  },
};

export class Menu {
  items: { title: string }[] = [];
  addItem(cb: (item: unknown) => void): this {
    const item = {
      title: '',
      setTitle(t: string) {
        this.title = t;
        return this;
      },
      setIcon() {
        return this;
      },
      setChecked() {
        return this;
      },
      onClick() {
        return this;
      },
      setSubmenu: () => new Menu(),
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtMouseEvent(): void {}
}

export class Notice {
  static messages: string[] = [];
  constructor(msg: string) {
    Notice.messages.push(msg);
  }
}

export class Modal {
  containerEl = document.createElement('div');
  modalEl = document.createElement('div');
  titleEl = document.createElement('div');
  contentEl = document.createElement('div');
  constructor(public app: unknown) {
    this.modalEl.append(this.titleEl, this.contentEl);
    this.containerEl.appendChild(this.modalEl);
  }
  open(): void {
    document.body.appendChild(this.containerEl);
    (this as unknown as { onOpen?: () => void }).onOpen?.();
  }
  close(): void {
    (this as unknown as { onClose?: () => void }).onClose?.();
    this.containerEl.remove();
  }
}

export class PluginSettingTab {}
export class Setting {}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}

export class TFile {
  basename: string;
  extension: string;
  stat = { mtime: 1, ctime: 1, size: 1 };
  constructor(public path: string) {
    const name = path.split('/').pop()!;
    this.basename = name.replace(/\.[^.]+$/, '');
    this.extension = name.split('.').pop()!;
  }
}
export class TFolder {}
export class ItemView extends Component {}
export class FileView extends Component {}
export class TextFileView extends Component {}
export class WorkspaceLeaf {}
export class WorkspaceSplit {}

export const Platform = { isMobile: false, isPhone: false };
export function debounce<T extends (...a: never[]) => void>(fn: T): T {
  return fn;
}
export function normalizePath(p: string): string {
  return p;
}
export function getAllTags(cache: { frontmatter?: { tags?: string[] } }): string[] {
  return (cache.frontmatter?.tags ?? []).map((t) => `#${t}`);
}
