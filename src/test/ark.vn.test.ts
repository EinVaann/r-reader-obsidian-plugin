// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArkSegment, ArkStory } from '../readers/ark/renderChapter';
import { VnScript, type Choices, type Frame } from '../readers/ark/vn/script';
import { VnPlayer } from '../readers/ark/vn/VnPlayer';

const say = (speaker: string, text: string, extra: Partial<ArkSegment> = {}): ArkSegment => ({ segment_type: 'dialogue', speaker, text, ...extra });
const dir = (action: string, params: Record<string, unknown> = {}, extra: Partial<ArkSegment> = {}): ArkSegment => ({
  segment_type: 'stage_direction',
  action,
  params,
  ...extra,
});

/** Prologue-like story: music, background, a CG that clears, a two-option choice. */
const STORY: ArkStory = {
  format: 'ark',
  version: 1,
  eventId: 'main_0',
  eventName: 'Evil Time Part 1',
  chapters: [
    {
      id: 'c0',
      title: 'Prologue, Part 1',
      nodes: [
        {
          nodeId: 'n0',
          avgTag: 'Interlude',
          segments: [
            dir('PlayMusic', { key: '$babel_loop' }),
            dir('Background', { image: 'bg_indoor_1' }),
            dir('Image', { image: 'avg_0_2' }),
            say('???', 'Doctor...'),
            dir('Image', {}),
            dir('PlaySound', { key: '$flashback' }),
            say('Medic', 'Are you awake?', { character_sprite: 'char_016_medic', character_sprite_2: 'char_002_amiya_1_4', character_focus: 1 }),
            { segment_type: 'choice', speaker: 'Doctor', choices: [{ text: 'Can I trust you?', value: '1' }, { text: '...', value: '2' }] },
            say('Amiya', 'I understand.', { choice_values: ['1'] }),
            say('Amiya', 'You really do not remember?', { choice_values: ['2'] }),
            dir('stopmusic'),
            say('Amiya', 'Let us go.'),
          ],
        },
      ],
    },
    { id: 'c1', title: 'Collapse', nodes: [{ nodeId: 'n1', avgTag: 'Before Operation', segments: [say('Ace', 'Move out.')] }] },
  ],
};

function frames(choices: Choices = new Map()): Frame[] {
  const script = new VnScript(STORY);
  const out: Frame[] = [];
  let { next, run } = script.chapterStart(0);
  for (let step = script.next(next, run, choices); step; step = script.next(next, run, choices)) {
    out.push(step.frame);
    ({ next, run } = step);
  }
  return out;
}

const describeStop = (f: Frame): string =>
  f.stop.kind === 'title' ? `title:${f.stop.title}` : f.stop.kind === 'choice' ? 'choice' : `${f.stop.speaker ?? ''}:${f.stop.text}`;

describe('visual-novel script', () => {
  it('walks titles, lines and choices in order, the first option by default', () => {
    expect(frames().map(describeStop)).toEqual([
      'title:Prologue, Part 1',
      '???:Doctor...',
      'Medic:Are you awake?',
      'choice',
      'Amiya:I understand.',
      'Amiya:Let us go.',
      'title:Collapse',
      'Ace:Move out.',
    ]);
  });

  it('a picked option plays only its branch', () => {
    const lines = frames(new Map([['0:0', '2']])).map(describeStop);
    expect(lines).toContain('Amiya:You really do not remember?');
    expect(lines).not.toContain('Amiya:I understand.');
  });

  it('keeps the background until changed, clears the CG, tracks music and sounds', () => {
    const [, doctor, medic, , , after, collapse] = frames();
    expect(doctor.stage).toEqual({ bg: 'bg:bg_indoor_1', cg: 'cgs:avg_0_2', music: 'music:$babel_loop' });
    expect(medic.stage).toEqual({ bg: 'bg:bg_indoor_1', cg: null, music: 'music:$babel_loop' });
    expect(medic.sounds).toEqual(['sounds:$flashback']);
    expect(after.stage.music).toBeNull(); // stopmusic
    expect(collapse.stage).toEqual({ bg: null, cg: null, music: null }); // a new chapter starts clear
    expect(medic.stop.kind === 'line' && medic.stop.sprites).toEqual(['sprites:char_016_medic', 'sprites:char_002_amiya_1_4']);
    expect(medic.stop.kind === 'line' && medic.stop.focus).toBe(0);
  });

  it('replays to a line with the history that leads there', () => {
    const steps = new VnScript(STORY).replayTo({ chapter: 0, node: 0, seg: 6 }, new Map());
    expect(steps.map((s) => s.frame.key)).toEqual(['0:0:-1', '0:0:3', '0:0:6']);
  });
});

describe('visual-novel player', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.empty();
  });

  function mount() {
    vi.stubGlobal(
      'Audio',
      class {
        loop = false;
        play = () => Promise.resolve();
        pause = () => {};
      },
    );
    const host = document.body.createDiv();
    const shown: string[] = [];
    const chosen: string[] = [];
    const player = new VnPlayer(
      host,
      STORY,
      (id) => `app://${id}`,
      {
        nickname: 'Doctor',
        textSpeed: 0,
        onToggleChrome: () => shown.push('chrome'),
        onFrame: (f) => shown.push(f.key),
        onChoose: (c, n, v) => chosen.push(`${c}:${n}=${v}`),
      },
      new Map(),
    );
    const root = host.querySelector<HTMLElement>('.rr-vn')!;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    const tap = (x: number, y: number): void => {
      root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    };
    return { player, root, shown, chosen, tap };
  }

  it('taps: right/bottom continues, top/left goes back, center toggles the bars', () => {
    const { player, root, shown, tap } = mount();
    player.start(null);
    expect(root.querySelector('.rr-vn-title-main')?.textContent).toBe('Prologue, Part 1');
    tap(90, 90);
    expect(root.querySelector('.rr-vn-text')?.textContent).toBe('Doctor...');
    expect(root.querySelector<HTMLImageElement>('.rr-vn-cg')?.classList.contains('is-shown')).toBe(true);
    tap(90, 10); // right edge, near the top: still the continue side
    expect(root.querySelector('.rr-vn-speaker')?.textContent).toBe('Medic');
    expect(root.querySelectorAll('.rr-vn-char')).toHaveLength(2);
    expect(root.querySelectorAll('.rr-vn-char.is-dim')).toHaveLength(1);
    tap(10, 40); // left side: back
    expect(root.querySelector('.rr-vn-text')?.textContent).toBe('Doctor...');
    tap(50, 50);
    expect(shown).toContain('chrome');
    expect(shown.slice(0, 3)).toEqual(['0:0:-1', '0:0:3', '0:0:6']);
  });

  it('a choice waits for an option, then plays its branch', () => {
    const { player, root, chosen, tap } = mount();
    player.start({ chapter: 0, node: 0, seg: 7 });
    expect(root.querySelectorAll('.rr-vn-option')).toHaveLength(2);
    tap(90, 90); // tapping the stage doesn't skip a choice
    expect(root.querySelectorAll('.rr-vn-option')).toHaveLength(2);
    root.querySelectorAll<HTMLElement>('.rr-vn-option')[1].click();
    expect(chosen).toEqual(['0:0=2']);
    expect(root.querySelector('.rr-vn-text')?.textContent).toBe('You really do not remember?');
  });

  it('the log lists lines read and jumps back to one', () => {
    const { player, root, tap } = mount();
    player.start(null);
    tap(90, 90);
    tap(90, 90);
    root.querySelector<HTMLElement>('.rr-vn-btn[aria-label="Log"]')!.click();
    const items = root.querySelectorAll<HTMLElement>('.rr-vn-log-item');
    expect(Array.from(items).map((i) => i.textContent)).toEqual(['???Doctor...', 'MedicAre you awake?']);
    items[0].click();
    expect(root.querySelector('.rr-vn-log')).toBeNull();
    expect(root.querySelector('.rr-vn-text')?.textContent).toBe('Doctor...');
  });
});
