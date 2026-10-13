import { focusIndex, mediaId, type ArkSegment, type ArkStory } from '../renderChapter';

/** The next segment to process. `seg: -1` is a node start (title card, if any). */
export interface Cursor {
  chapter: number;
  node: number;
  seg: number;
}

/** What stays on stage between lines: media IDs, null when cleared. */
export interface StageState {
  bg: string | null;
  cg: string | null;
  music: string | null;
}

/** Interpreter state carried from one frame to the next. */
export interface RunState {
  stage: StageState;
  /** Key of the choice whose branch lines are being read, if any. */
  branch: string | null;
}

export type Stop =
  | { kind: 'title'; title: string; subtitle: string | null }
  | { kind: 'line'; speaker: string | null; text: string; narration: boolean; sprites: string[]; focus: number | null }
  | { kind: 'choice'; speaker: string; options: { text: string; value: string }[]; choice: string };

/** One place the reader stops and taps, with the stage as it is there. */
export interface Frame {
  /** `chapter:node:seg` of the segment shown, matching the script view's `data-seg`. */
  key: string;
  at: Cursor;
  stop: Stop;
  stage: StageState;
  /** Sound effects that play on arriving here. */
  sounds: string[];
}

/** A frame plus where to continue from after it. */
export interface Step {
  frame: Frame;
  next: Cursor;
  run: RunState;
}

/** Picked option value per choice key (`chapter:choiceNumber`). */
export type Choices = Map<string, string>;

const TEXT_ACTIONS = new Set(['narration', 'subtitle', 'sticker']);
const EMPTY_STAGE: StageState = { bg: null, cg: null, music: null };

export function segKey(c: Cursor): string {
  return `${c.chapter}:${c.node}:${c.seg}`;
}

/** Order of two cursors in the story (negative: a first). */
export function compareCursor(a: Cursor, b: Cursor): number {
  return a.chapter - b.chapter || a.node - b.node || a.seg - b.seg;
}

export function parseKey(key: string): Cursor | null {
  const m = /^(\d+):(\d+):(-?\d+)$/.exec(key);
  return m ? { chapter: Number(m[1]), node: Number(m[2]), seg: Number(m[3]) } : null;
}

/** Lines that close an open branch when they carry no `choice_values` (as in the script view). */
function isContent(seg: ArkSegment): boolean {
  const action = (seg.action ?? '').toLowerCase();
  if (seg.segment_type !== 'stage_direction') return seg.segment_type !== 'choice';
  return ['playmusic', 'playsound', 'image', 'background', ...TEXT_ACTIONS].includes(action);
}

/**
 * Walks a story's script for the visual-novel view: stage directions update
 * the background, CG and music; dialogue, narration, subtitles and choices
 * become frames. Unchosen branches are skipped (the first option by default).
 */
export class VnScript {
  /** Choice key → options, and segment key → choice key, numbered like the script view. */
  private options = new Map<string, { text: string; value: string }[]>();
  private choiceAt = new Map<string, string>();

  constructor(private story: ArkStory) {
    story.chapters.forEach((ch, ci) => {
      let n = 0;
      ch.nodes.forEach((node, ni) =>
        node.segments.forEach((seg, si) => {
          if (seg.segment_type !== 'choice' || !seg.choices?.length) return;
          const key = `${ci}:${n++}`;
          this.options.set(key, seg.choices);
          this.choiceAt.set(`${ci}:${ni}:${si}`, key);
        }),
      );
    });
  }

  /** Where a chapter starts, with an empty stage. */
  chapterStart(chapter: number): { next: Cursor; run: RunState } {
    return { next: { chapter, node: 0, seg: -1 }, run: { stage: { ...EMPTY_STAGE }, branch: null } };
  }

  private picked(choice: string, choices: Choices): string | undefined {
    return choices.get(choice) ?? this.options.get(choice)?.[0]?.value;
  }

  /** The next frame after `from`, or null at the end of the story. */
  next(from: Cursor, prev: RunState, choices: Choices): Step | null {
    const chapters = this.story.chapters;
    const c = { ...from };
    const run: RunState = { stage: { ...prev.stage }, branch: prev.branch };
    const sounds: string[] = [];

    while (c.chapter < chapters.length) {
      const chapter = chapters[c.chapter];
      if (c.node >= chapter.nodes.length) {
        Object.assign(c, { chapter: c.chapter + 1, node: 0, seg: -1 });
        continue;
      }
      const node = chapter.nodes[c.node];
      if (c.seg === -1) {
        const at = { ...c };
        c.seg = 0;
        run.branch = null;
        if (c.node === 0) run.stage = { ...EMPTY_STAGE }; // each chapter starts on a clear stage
        const title = c.node === 0 ? chapter.title : node.avgTag ? chapter.title : null;
        if (title) {
          const stop: Stop = { kind: 'title', title, subtitle: node.avgTag ?? null };
          return { frame: { key: segKey(at), at, stop, stage: { ...run.stage }, sounds }, next: { ...c }, run };
        }
        continue;
      }
      if (c.seg >= node.segments.length) {
        Object.assign(c, { node: c.node + 1, seg: -1 });
        continue;
      }

      const at = { ...c };
      const seg = node.segments[c.seg++];
      const values = seg.choice_values;
      if (run.branch && values?.length) {
        if (!values.includes(this.picked(run.branch, choices) ?? '')) continue;
      } else if (!values?.length && isContent(seg)) {
        run.branch = null;
      }

      const stop = this.apply(seg, run, sounds, segKey(at));
      if (stop) return { frame: { key: segKey(at), at, stop, stage: { ...run.stage }, sounds }, next: { ...c }, run };
    }
    return null;
  }

  /** Apply one segment to the stage; returns a stop when the reader should pause on it. */
  private apply(seg: ArkSegment, run: RunState, sounds: string[], key: string): Stop | null {
    const action = (seg.action ?? '').toLowerCase();
    const params = seg.params ?? {};
    const stage = run.stage;

    if (seg.segment_type === 'dialogue' && seg.text) {
      const sprites = [
        mediaId(seg, 'character_sprite', 'sprites', seg.character_sprite),
        mediaId(seg, 'character_sprite_2', 'sprites', seg.character_sprite_2),
      ].filter((id): id is string => !!id && !id.endsWith(':doctor_sprite'));
      const focus = sprites.length > 1 ? focusIndex(seg.character_focus) : null;
      return { kind: 'line', speaker: seg.speaker || null, text: seg.text, narration: false, sprites, focus };
    }
    if (seg.segment_type === 'narration' && seg.text) {
      return { kind: 'line', speaker: null, text: seg.text, narration: true, sprites: [], focus: null };
    }
    if (seg.segment_type === 'choice' && seg.choices?.length) {
      const choice = this.choiceAt.get(key) ?? '';
      run.branch = choice;
      return { kind: 'choice', speaker: seg.speaker || 'Doctor', options: seg.choices, choice };
    }
    if (action === 'background') {
      stage.bg = typeof params.image === 'string' && params.image ? mediaId(seg, 'params.image', 'bg', params.image) : null;
    } else if (action === 'image') {
      stage.cg = typeof params.image === 'string' && params.image ? mediaId(seg, 'params.image', 'cgs', params.image) : null;
    } else if (action === 'playmusic' && typeof params.key === 'string') {
      stage.music = mediaId(seg, 'params.key', 'music', params.key);
    } else if (action === 'stopmusic') {
      stage.music = null;
    } else if (action === 'playsound' && typeof params.key === 'string') {
      const id = mediaId(seg, 'params.key', 'sounds', params.key);
      if (id) sounds.push(id);
    } else if (TEXT_ACTIONS.has(action) && typeof params.text === 'string' && params.text.trim()) {
      return { kind: 'line', speaker: null, text: params.text, narration: true, sprites: [], focus: null };
    }
    return null;
  }

  /**
   * Frames from the start of `target`'s chapter up to the first frame at or
   * after `target`: the history a reader would have seen arriving there.
   */
  replayTo(target: Cursor, choices: Choices): Step[] {
    const steps: Step[] = [];
    let { next, run } = this.chapterStart(target.chapter);
    for (;;) {
      const step = this.next(next, run, choices);
      if (!step) break;
      steps.push(step);
      if (compareCursor(step.frame.at, target) >= 0) break;
      ({ next, run } = step);
    }
    return steps;
  }
}
