import { App, Modal, Setting } from 'obsidian';

/**
 * A tiny single-field text prompt. Resolves with the entered string, or null if
 * the user cancels. Used to name bookmarks.
 */
export class PromptModal extends Modal {
  private value: string;
  private title: string;
  private placeholder: string;
  private onResolve: (value: string | null) => void;
  private submitted = false;

  constructor(
    app: App,
    opts: { title: string; defaultValue?: string; placeholder?: string },
    onResolve: (value: string | null) => void,
  ) {
    super(app);
    this.title = opts.title;
    this.value = opts.defaultValue ?? '';
    this.placeholder = opts.placeholder ?? '';
    this.onResolve = onResolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });

    const setting = new Setting(contentEl).addText((t) => {
      t.setPlaceholder(this.placeholder)
        .setValue(this.value)
        .onChange((v) => (this.value = v));
      t.inputEl.style.width = '100%';
      // Submit on Enter.
      t.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => {
        t.inputEl.focus();
        t.inputEl.select();
      }, 0);
    });
    setting.settingEl.style.border = 'none';
    setting.settingEl.style.padding = '0';

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Save').setCta().onClick(() => this.submit()));
  }

  private submit(): void {
    this.submitted = true;
    const v = this.value.trim();
    this.onResolve(v || null);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.onResolve(null);
  }
}

/** Promise wrapper around PromptModal. */
export function promptForText(
  app: App,
  opts: { title: string; defaultValue?: string; placeholder?: string },
): Promise<string | null> {
  return new Promise((resolve) => {
    new PromptModal(app, opts, resolve).open();
  });
}
