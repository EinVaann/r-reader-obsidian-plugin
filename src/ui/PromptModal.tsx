import { useState } from 'react';
import type { App } from 'obsidian';
import { ReactModal } from '../react/mount';

interface PromptOptions {
  title: string;
  defaultValue?: string;
  placeholder?: string;
}

function Prompt({ opts, onSubmit, onCancel }: { opts: PromptOptions; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(opts.defaultValue ?? '');
  return (
    <div className="rr-prompt">
      <h3>{opts.title}</h3>
      <input
        className="rr-prompt-input"
        type="text"
        value={value}
        placeholder={opts.placeholder}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit(value);
          }
        }}
      />
      <div className="rr-prompt-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="mod-cta" onClick={() => onSubmit(value)}>
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * A single-field text prompt (used to name bookmarks). Resolves with the
 * trimmed text, or null if cancelled or left empty.
 */
export function promptForText(app: App, opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    new ReactModal(
      app,
      (modal) => (
        <Prompt
          opts={opts}
          onCancel={() => modal.close()}
          onSubmit={(v) => {
            result = v.trim() || null;
            modal.close();
          }}
        />
      ),
      { onClosed: () => resolve(result) },
    ).open();
  });
}
