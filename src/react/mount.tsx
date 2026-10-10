import { StrictMode, createContext, useContext, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, type App } from 'obsidian';

/** The Obsidian app, available to every React tree the plugin mounts. */
const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp() outside an R Reader React root');
  return app;
}

/**
 * Mount a React tree into an Obsidian-owned element. Returns the unmount
 * function — call it from the owner's close/unload hook, or the tree (and its
 * listeners) leaks across Hot-Reloads.
 */
export function mountReact(app: App, container: HTMLElement, node: ReactNode): () => void {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <AppContext.Provider value={app}>{node}</AppContext.Provider>
    </StrictMode>,
  );
  return () => root.unmount();
}

/** An Obsidian modal whose content is a React tree. */
export class ReactModal extends Modal {
  private unmount: (() => void) | null = null;

  constructor(
    app: App,
    private readonly render: (modal: ReactModal) => ReactNode,
    private readonly opts: { title?: string; cls?: string; onClosed?: () => void } = {},
  ) {
    super(app);
  }

  onOpen(): void {
    if (this.opts.title) this.titleEl.setText(this.opts.title);
    if (this.opts.cls) this.modalEl.addClass(this.opts.cls);
    this.unmount = mountReact(this.app, this.contentEl, this.render(this));
  }

  onClose(): void {
    this.unmount?.();
    this.unmount = null;
    this.opts.onClosed?.();
  }
}
