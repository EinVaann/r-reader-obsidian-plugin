import { type App, normalizePath, Notice, TFile, TFolder } from 'obsidian';
import type { BookAnnotations, Highlight } from '../annotations/types';
import type { TocEntry } from '../readers/EpubReader';

interface ExportContext {
  bookTitle: string;
  author?: string;
  /** Map from chapter index → readable chapter label (from the TOC). */
  chapterLabel: (index: number) => string;
}

/** Build the Markdown body for a book's reading notes. */
function buildMarkdown(file: TFile, ann: BookAnnotations, ctx: ExportContext): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.bookTitle}`);
  if (ctx.author) lines.push(`*by ${ctx.author}*`);
  lines.push('');
  lines.push(`> [!info] Source`);
  lines.push(`> [[${file.path}|${file.basename}]]`);
  lines.push('');

  // Highlights grouped by chapter, in chapter then creation order.
  const highlights = [...ann.highlights].sort(
    (a, b) => a.chapterIndex - b.chapterIndex || a.createdAt - b.createdAt,
  );
  if (highlights.length > 0) {
    lines.push('## Highlights');
    lines.push('');
    let currentChapter = -1;
    for (const h of highlights) {
      if (h.chapterIndex !== currentChapter) {
        currentChapter = h.chapterIndex;
        lines.push(`### ${ctx.chapterLabel(h.chapterIndex)}`);
        lines.push('');
      }
      lines.push(formatHighlight(h));
      lines.push('');
    }
  }

  // Bookmarks.
  if (ann.bookmarks.length > 0) {
    lines.push('## Bookmarks');
    lines.push('');
    for (const b of [...ann.bookmarks].sort((a, b2) => a.chapterIndex - b2.chapterIndex)) {
      lines.push(`- **${b.name}** — ${ctx.chapterLabel(b.chapterIndex)}`);
    }
    lines.push('');
  }

  if (highlights.length === 0 && ann.bookmarks.length === 0) {
    lines.push('*No highlights or bookmarks yet.*');
    lines.push('');
  }

  return lines.join('\n');
}

function formatHighlight(h: Highlight): string {
  const quote = h.text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  let out = `> [!quote]${h.color !== 'yellow' ? ` ${capitalize(h.color)}` : ''}\n${quote}`;
  if (h.note && h.note.trim()) {
    out += `\n\n${h.note.trim()}`;
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ensure a folder path exists (creating intermediate folders). */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
  if (!folderPath) return;
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (existing instanceof TFolder) return;
  try {
    await app.vault.createFolder(folderPath);
  } catch {
    /* already exists / race — ignore */
  }
}

/**
 * Export a book's highlights + bookmarks to a Markdown note. Overwrites the
 * note if it already exists (regenerates the whole file). Returns the path.
 */
export async function exportBookNotes(
  app: App,
  file: TFile,
  ann: BookAnnotations,
  toc: TocEntry[],
  metadata: { title?: string; author?: string },
  folder: string,
): Promise<string> {
  const chapterLabel = (index: number): string => {
    let best = '';
    for (const e of toc) {
      if (e.index >= 0 && e.index <= index) best = e.label;
    }
    return best || `Chapter ${index + 1}`;
  };

  const ctx: ExportContext = {
    bookTitle: metadata.title?.trim() || file.basename,
    author: metadata.author?.trim() || undefined,
    chapterLabel,
  };

  const folderPath = normalizePath(folder.trim());
  await ensureFolder(app, folderPath);

  const md = buildMarkdown(file, ann, ctx);
  const targetPath = normalizePath(`${folderPath ? folderPath + '/' : ''}${file.basename}.md`);

  const existing = app.vault.getAbstractFileByPath(targetPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, md);
  } else {
    await app.vault.create(targetPath, md);
  }

  new Notice(`R Reader: exported notes to ${targetPath}`);
  return targetPath;
}
