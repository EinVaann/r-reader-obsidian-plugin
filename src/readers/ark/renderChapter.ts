/** Shapes of the Distant Homes story files (`.ark`) the renderer reads. */
export interface ArkSegment {
  segment_type: 'dialogue' | 'narration' | 'choice' | 'stage_direction';
  action?: string;
  text?: string;
  speaker?: string;
  params?: Record<string, unknown>;
  /** Source field (e.g. `params.key`, `character_sprite`) → media ID (`music:$babel_loop`). */
  media?: Record<string, string>;
  character_sprite?: string;
  character_sprite_2?: string;
  character_focus?: string | number;
  choices?: { text: string; value: string }[];
  /** Set on lines that only play after one of the preceding choice's options. */
  choice_values?: string[];
}

export interface ArkNode {
  nodeId: string;
  nodeTitle?: string;
  avgTag?: string;
  segments: ArkSegment[];
}

export interface ArkChapter {
  id: string;
  title: string;
  nodes: ArkNode[];
}

/** One `.ark` file: a whole story with its chapters in reading order. */
export interface ArkStory {
  format: 'ark';
  version: number;
  eventId: string;
  eventName: string;
  chapters: ArkChapter[];
}

/** Resolves a media ID to a loadable URL, or null when the asset is missing. */
export type MediaResolver = (mediaId: string) => string | null;

const MUSIC_ACTIONS = new Set(['playmusic']);
const SOUND_ACTIONS = new Set(['playsound']);
const IMAGE_ACTIONS = new Set(['image', 'background']);
const TEXT_ACTIONS = new Set(['narration', 'subtitle', 'sticker']);
/** Plain fills that would render as empty cards. */
const SKIP_IMAGES = /^bg_(black|white)$/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Story text → HTML: keeps <i>/<b>/<br/>, drops color tags, fills placeholders. */
export function formatText(raw: string, nickname: string): string {
  return escapeHtml(raw)
    .replace(/&lt;(\/?)(i|b)&gt;/g, '<$1$2>')
    .replace(/&lt;i\/&gt;/g, '')
    .replace(/&lt;br\s*\/?&gt;|\\n|\n/g, '<br>')
    .replace(/&lt;\/?color(=[^&]*)?&gt;/g, '')
    .replace(/\{@nickname\}/gi, `<span class="rr-ark-nick">${escapeHtml(nickname)}</span>`)
    .replace(/\{@nbs\}/g, '&nbsp;');
}

/** Display name of a music/sound key: `$babel_loop` → `$babel`. */
export function trackName(key: string): string {
  return key.replace(/_(loop|intro)$/i, '');
}

function mediaId(seg: ArkSegment, field: string, kind: string, name: unknown): string | null {
  const id = seg.media?.[field];
  if (id) return id;
  return typeof name === 'string' && name ? `${kind}:${name}` : null;
}

/** Which of two on-screen sprites is in focus: 0, 1, or null for both. */
function focusIndex(focus: ArkSegment['character_focus']): number | null {
  const f = String(focus ?? '').toLowerCase();
  if (f === '1' || f === 'l' || f === 'left') return 0;
  if (f === '2' || f === 'r' || f === 'right') return 1;
  return null;
}

/** Tracks which choice the following branch lines belong to. */
interface BranchState {
  choice: number;
  /** The option shown by default (the first). */
  selected: string;
}

/**
 * Render one story chapter as reader HTML. Stage directions that only drive
 * animation are dropped; music, sounds, scene images, dialogue, narration and
 * choices are kept. Branch lines after a choice carry `data-choice`/`data-values`
 * and are hidden unless their option is selected (the first, initially).
 */
export function renderChapter(chapter: ArkChapter, resolve: MediaResolver, nickname: string): string {
  const out: string[] = [];
  let lastImage = '';
  let choiceCount = 0;
  let branch: BranchState | null = null;

  /** Opening tag; lines inside a choice's branch get its markers (and start hidden if unselected). */
  const open = (tag: string, cls: string, seg: ArkSegment, extra = ''): string => {
    const values = seg.choice_values;
    if (!branch || !values || values.length === 0) {
      branch = null; // the first line outside a branch ends it
      return `<${tag} class="${cls}"${extra}>`;
    }
    const hidden = values.includes(branch.selected) ? '' : ' is-hidden';
    const attrs = ` data-choice="${branch.choice}" data-values="${escapeHtml(values.join(' '))}"`;
    return `<${tag} class="${cls} rr-ark-branch${hidden}"${attrs}${extra}>`;
  };

  chapter.nodes.forEach((node, ni) => {
    const tag = node.avgTag ? escapeHtml(node.avgTag) : '';
    if (ni === 0) {
      out.push(`<header class="rr-ark-head"><h1 class="rr-ark-title">${escapeHtml(chapter.title)}</h1>`);
      if (tag) out.push(`<p class="rr-ark-tag">${tag}</p>`);
      out.push('</header>');
    } else if (tag) {
      out.push(`<h2 class="rr-ark-node" id="${escapeHtml(node.nodeId)}">${tag}</h2>`);
    }
    branch = null;

    for (const seg of node.segments) {
      const action = (seg.action ?? '').toLowerCase();
      const params = seg.params ?? {};

      if (seg.segment_type === 'dialogue' && seg.text) {
        const sprites = [
          mediaId(seg, 'character_sprite', 'sprites', seg.character_sprite),
          mediaId(seg, 'character_sprite_2', 'sprites', seg.character_sprite_2),
        ].filter((id): id is string => !!id && !id.endsWith(':doctor_sprite'));
        const focus = sprites.length > 1 ? focusIndex(seg.character_focus) : null;
        const portraits = sprites
          .map((id, i) => {
            const url = resolve(id);
            if (!url) return '';
            const dim = focus !== null && focus !== i ? ' is-dim' : '';
            return `<span class="rr-ark-portrait${dim}" role="button" tabindex="0" aria-label="Show full sprite"><img src="${escapeHtml(url)}" alt="" loading="lazy"></span>`;
          })
          .join('');
        out.push(open('div', portraits ? 'rr-ark-line has-portrait' : 'rr-ark-line', seg));
        if (portraits) out.push(`<span class="rr-ark-portraits">${portraits}</span>`);
        if (seg.speaker) out.push(`<p class="rr-ark-speaker">${escapeHtml(seg.speaker)}</p>`);
        out.push(`<p class="rr-ark-text">${formatText(seg.text, nickname)}</p></div>`);
      } else if (seg.segment_type === 'narration' && seg.text) {
        out.push(`${open('p', 'rr-ark-narration', seg)}${formatText(seg.text, nickname)}</p>`);
      } else if (seg.segment_type === 'choice' && seg.choices?.length) {
        const n = choiceCount++;
        branch = null; // a choice is never itself part of the previous branch
        out.push(`<div class="rr-ark-choice" data-choice="${n}">`);
        out.push(`<p class="rr-ark-speaker">${escapeHtml(seg.speaker || 'Doctor')}</p>`);
        seg.choices.forEach((c, i) => {
          const sel = i === 0 ? ' is-selected' : '';
          out.push(
            `<p class="rr-ark-option${sel}" role="button" tabindex="0" data-choice="${n}" data-value="${escapeHtml(c.value)}">${formatText(c.text, nickname)}</p>`,
          );
        });
        out.push('</div>');
        branch = { choice: n, selected: seg.choices[0].value };
      } else if (MUSIC_ACTIONS.has(action) && typeof params.key === 'string') {
        const url = resolve(mediaId(seg, 'params.key', 'music', params.key) ?? '');
        const name = trackName(params.key);
        out.push(open('p', 'rr-ark-music', seg, ` role="button" tabindex="0" data-kind="music" data-name="${escapeHtml(name.replace(/^\$/, ''))}"${url ? ` data-src="${escapeHtml(url)}"` : ''}`));
        out.push(`<span class="rr-ark-note">♪</span> Now playing: <code>${escapeHtml(name)}</code></p>`);
      } else if (action === 'stopmusic') {
        // Invisible marker: autoplay goes quiet here. Leaves branch state alone.
        out.push('<div class="rr-ark-music-stop" aria-hidden="true"></div>');
      } else if (SOUND_ACTIONS.has(action) && typeof params.key === 'string') {
        const url = resolve(mediaId(seg, 'params.key', 'sounds', params.key) ?? '');
        const name = trackName(params.key).replace(/^\$/, '');
        out.push(open('div', 'rr-ark-sfx', seg));
        out.push(
          `<span class="rr-ark-sfx-btn" role="button" tabindex="0" aria-label="Play sound ${escapeHtml(name)}" data-kind="sound" data-name="${escapeHtml(name)}"${url ? ` data-src="${escapeHtml(url)}"` : ''}></span></div>`,
        );
      } else if (IMAGE_ACTIONS.has(action) && typeof params.image === 'string' && params.image) {
        if (params.image === lastImage || SKIP_IMAGES.test(params.image)) continue;
        const kind = action === 'image' ? 'cgs' : 'bg';
        const url = resolve(mediaId(seg, 'params.image', kind, params.image) ?? '');
        if (!url) continue;
        lastImage = params.image;
        out.push(
          `${open('figure', 'rr-ark-scene', seg)}<img src="${escapeHtml(url)}" alt="${escapeHtml(params.image)}" role="button" tabindex="0" loading="lazy"></figure>`,
        );
      } else if (TEXT_ACTIONS.has(action) && typeof params.text === 'string' && params.text.trim()) {
        out.push(`${open('p', 'rr-ark-narration', seg)}${formatText(params.text, nickname)}</p>`);
      }
    }
  });
  return `<section class="rr-ark-chapter">${out.join('')}</section>`;
}
