/** Helpers to read foliate's metadata, which uses language-maps + contributor
 *  arrays whose fields may be strings or `{ [lang]: string }` objects. */

type LangMap = Record<string, string>;
type MaybeLang = string | LangMap | undefined | null;
interface Contributor { name?: MaybeLang; }

export interface BookMeta {
  title?: MaybeLang;
  author?: Contributor[] | MaybeLang;
  creator?: Contributor[] | MaybeLang;
}

function flatten(value: MaybeLang): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  // LanguageMap: prefer the first value.
  const first = Object.values(value)[0];
  return typeof first === 'string' ? first : '';
}

export function metaTitle(meta: BookMeta | null | undefined, fallback: string): string {
  const t = flatten(meta?.title).trim();
  return t || fallback;
}

export function metaAuthor(meta: BookMeta | null | undefined): string | undefined {
  const raw = meta?.author ?? meta?.creator;
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const names = raw.map((c) => flatten(c?.name).trim()).filter(Boolean);
    return names.length ? names.join(', ') : undefined;
  }
  const single = flatten(raw).trim();
  return single || undefined;
}
