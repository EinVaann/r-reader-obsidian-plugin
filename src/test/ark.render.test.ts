// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Notice } from './obsidian-mock';
import { formatText, renderChapter, trackName, type ArkChapter, type ArkSegment } from '../readers/ark/renderChapter';
import { ArkInteractions } from '../readers/ark/ArkInteractions';

const MISSING = new Set(['music:$ekg_loop']);
const resolve = (id: string): string | null => (MISSING.has(id) || !id ? null : `app://media/${id}`);

function chapter(segments: ArkSegment[], avgTag = 'Interlude'): ArkChapter {
  return { id: 'c', title: 'Prologue, Part 1', nodes: [{ nodeId: 'n1', avgTag, segments }] };
}

function render(segments: ArkSegment[]): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = renderChapter(chapter(segments), resolve, 'Rhine');
  return el;
}

describe('ark story rendering', () => {
  it('header: chapter title and node tag', () => {
    const el = render([]);
    expect(el.querySelector('.rr-ark-title')?.textContent).toBe('Prologue, Part 1');
    expect(el.querySelector('.rr-ark-tag')?.textContent).toBe('Interlude');
  });

  it('music bars name the track and mark missing ones', () => {
    const el = render([
      { segment_type: 'stage_direction', action: 'PlayMusic', params: { key: '$babel_loop' }, media: { 'params.key': 'music:$babel_loop' } },
      { segment_type: 'stage_direction', action: 'playMusic', params: { key: '$ekg_loop' }, media: { 'params.key': 'music:$ekg_loop' } },
    ]);
    const bars = el.querySelectorAll<HTMLElement>('.rr-ark-music');
    expect(bars).toHaveLength(2);
    expect(bars[0].querySelector('code')?.textContent).toBe('$babel');
    expect(bars[0].dataset.src).toBe('app://media/music:$babel_loop');
    expect(bars[1].dataset.name).toBe('ekg');
    expect(bars[1].dataset.src).toBeUndefined();
  });

  it('scene images skip blanks, repeats and plain fills', () => {
    const img = (image: string): ArkSegment => ({ segment_type: 'stage_direction', action: 'Image', params: { image }, media: { 'params.image': `cgs:${image}` } });
    const el = render([img('bg_0_babel'), img('bg_0_babel'), { segment_type: 'stage_direction', action: 'Image', params: {} }, img('bg_black'), img('bg_0_am')]);
    expect(Array.from(el.querySelectorAll('.rr-ark-scene img')).map((i) => i.getAttribute('alt'))).toEqual(['bg_0_babel', 'bg_0_am']);
  });

  it('dialogue: speaker, text, and portraits with the unfocused one dimmed', () => {
    const el = render([
      { segment_type: 'dialogue', speaker: 'Distant Voice', text: '...consciousness...' },
      {
        segment_type: 'dialogue',
        speaker: 'Medic',
        text: 'I understand.',
        character_sprite: 'char_016_medic',
        character_sprite_2: 'char_002_amiya_1_4',
        character_focus: 1,
        media: { character_sprite: 'sprites:char_016_medic', character_sprite_2: 'sprites:char_002_amiya_1_4' },
      },
    ]);
    const [voice, medic] = Array.from(el.querySelectorAll('.rr-ark-line'));
    expect(voice.querySelector('.rr-ark-portraits')).toBeNull();
    expect(medic.querySelector('.rr-ark-speaker')?.textContent).toBe('Medic');
    const portraits = medic.querySelectorAll('.rr-ark-portrait');
    expect(portraits).toHaveLength(2);
    expect(portraits[0].classList.contains('is-dim')).toBe(false);
    expect(portraits[1].classList.contains('is-dim')).toBe(true);
  });

  it('choices: first option selected, other branches start hidden, branch ends at the next plain line', () => {
    const line = (text: string, values?: string[]): ArkSegment => ({ segment_type: 'dialogue', speaker: 'Amiya', text, choice_values: values });
    const el = render([
      { segment_type: 'choice', speaker: 'Doctor', character_sprite: 'doctor_sprite', choices: [{ text: '...Can I trust you?', value: '1' }, { text: '...', value: '2' }] },
      line('I understand.', ['1']),
      line('Do you really not remember me?', ['2']),
      line('Both', ['1', '2']),
      line('After the branch'),
    ]);
    const options = el.querySelectorAll('.rr-ark-option');
    expect(options[0].classList.contains('is-selected')).toBe(true);
    expect(options[1].classList.contains('is-selected')).toBe(false);
    const lines = Array.from(el.querySelectorAll<HTMLElement>('.rr-ark-line'));
    expect(lines.map((l) => l.classList.contains('is-hidden'))).toEqual([false, true, false, false]);
    expect(lines[3].classList.contains('rr-ark-branch')).toBe(false);
    expect(lines[1].dataset.choice).toBe('0');
  });

  it('formats rich text and fills the nickname', () => {
    expect(formatText('<i>Dr. {@nickname}</i><color=#ff0>!</color>', 'Rhine')).toBe('<i>Dr. <span class="rr-ark-nick">Rhine</span></i>!');
    expect(formatText("<PRTS's First Functional Test>", 'x')).toBe('&lt;PRTS\'s First Functional Test&gt;');
    expect(formatText('a<br/>b', 'x')).toBe('a<br>b');
    expect(trackName('$darkness01_intro')).toBe('$darkness01');
  });
});

describe('ark story interactions', () => {
  function mount(): { el: HTMLElement; ark: ArkInteractions } {
    const el = render([
      { segment_type: 'stage_direction', action: 'Image', params: { image: 'avg_0_2' }, media: { 'params.image': 'cgs:avg_0_2' } },
      { segment_type: 'dialogue', speaker: 'Amiya', text: 'Doctor...?', character_sprite: 'char_002_amiya_1_3' },
      { segment_type: 'choice', speaker: 'Doctor', choices: [{ text: 'A', value: '1' }, { text: 'B', value: '2' }] },
      { segment_type: 'dialogue', speaker: 'Amiya', text: 'branch A', choice_values: ['1'] },
      { segment_type: 'dialogue', speaker: 'Amiya', text: 'branch B', choice_values: ['2'] },
    ]);
    document.body.appendChild(el);
    return { el, ark: new ArkInteractions(el) };
  }

  it('tapping a CG or portrait opens it full size; a tap or Escape closes it', () => {
    const { el, ark } = mount();
    el.querySelector<HTMLElement>('.rr-ark-scene img')!.click();
    expect(document.querySelector('.rr-ark-lightbox img')?.getAttribute('src')).toBe('app://media/cgs:avg_0_2');
    document.querySelector<HTMLElement>('.rr-ark-lightbox')!.click();
    expect(document.querySelector('.rr-ark-lightbox')).toBeNull();

    // A portrait shows the whole sprite behind the crop.
    el.querySelector<HTMLElement>('.rr-ark-portrait')!.click();
    expect(document.querySelector('.rr-ark-lightbox img')?.getAttribute('src')).toBe('app://media/sprites:char_002_amiya_1_3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.rr-ark-lightbox')).toBeNull();
    ark.destroy();
    el.remove();
  });

  it('tapping an option shows only its branch', () => {
    const { el, ark } = mount();
    const shown = (): string[] =>
      Array.from(el.querySelectorAll('.rr-ark-branch:not(.is-hidden) .rr-ark-text')).map((p) => p.textContent ?? '');
    expect(shown()).toEqual(['branch A']);
    el.querySelectorAll<HTMLElement>('.rr-ark-option')[1].click();
    expect(shown()).toEqual(['branch B']);
    expect(el.querySelectorAll('.rr-ark-option')[1].classList.contains('is-selected')).toBe(true);
    ark.destroy();
    el.remove();
  });

  it('autoplay follows the music marker above the middle of the screen', async () => {
    const played: FakeAudio[] = [];
    class FakeAudio {
      loop = false;
      paused = true;
      constructor(public src: string) {
        played.push(this);
      }
      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    const music = (key: string): ArkSegment => ({ segment_type: 'stage_direction', action: 'PlayMusic', params: { key }, media: { 'params.key': `music:${key}` } });
    const el = render([music('$babel_loop'), { segment_type: 'stage_direction', action: 'stopmusic' }, music('$ekg_loop')]);
    document.body.appendChild(el);

    // No layout in the test DOM: give the markers and the viewport fixed positions.
    const tops = [100, 500, 900];
    el.querySelectorAll<HTMLElement>('.rr-ark-music, .rr-ark-music-stop').forEach((m, i) => {
      m.getBoundingClientRect = () => ({ top: tops[i] }) as DOMRect;
    });
    const scroll = document.createElement('div');
    scroll.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    let height = 400;
    Object.defineProperty(scroll, 'clientHeight', { get: () => height });

    const ark = new ArkInteractions(el, scroll);
    ark.setAutoplay(true); // middle line at 200: the babel bar
    await Promise.resolve();
    expect(played.map((a) => a.src)).toEqual(['app://media/music:$babel_loop']);
    expect(played[0].paused).toBe(false);

    height = 1200; // line at 600: past the stop marker
    ark.syncMusic();
    expect(played[0].paused).toBe(true);

    height = 2000; // line at 1000: the ekg bar, which is missing
    Notice.messages.length = 0;
    ark.syncMusic();
    expect(Notice.messages).toEqual(['Track not available: ekg']);
    expect(played).toHaveLength(1);

    ark.setAutoplay(false);
    ark.destroy();
    el.remove();
    vi.unstubAllGlobals();
  });
});
