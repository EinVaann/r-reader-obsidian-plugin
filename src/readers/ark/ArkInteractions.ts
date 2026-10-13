import { Notice } from 'obsidian';

const ZOOMABLE = '.rr-ark-scene img, .rr-ark-portrait';
/** Music bars and "music stops here" markers, in reading order. */
const MUSIC_MARKERS = '.rr-ark-music, .rr-ark-music-stop';
/** Autoplay waits for scrolling to settle before switching tracks. */
const AUTOPLAY_DEBOUNCE_MS = 250;

/**
 * Taps inside a rendered story: picking a choice option shows that option's
 * branch lines, music bars and sound buttons play their audio, and scene
 * images and portraits open full size. With autoplay on, the music of the
 * scene at the middle of the screen plays as you scroll.
 */
export class ArkInteractions {
  private music: HTMLAudioElement | null = null;
  private musicEl: HTMLElement | null = null;
  private lightbox: HTMLElement | null = null;
  private autoplay = false;
  /** The music marker autoplay last acted on (null: above the first one). */
  private autoMarker: HTMLElement | null = null;
  private autoTimer: number | null = null;
  /** Autoplay was blocked until the first user gesture; retry on it. */
  private awaitingGesture = false;

  constructor(
    private contentEl: HTMLElement,
    private scrollEl: HTMLElement | null = null,
  ) {
    contentEl.addEventListener('click', this.onClick);
    contentEl.addEventListener('keydown', this.onKey);
  }

  private onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const option = target.closest<HTMLElement>('.rr-ark-option');
    if (option) {
      this.selectOption(option);
      return;
    }
    const zoom = target.closest<HTMLElement>(ZOOMABLE);
    if (zoom) {
      const img = zoom instanceof HTMLImageElement ? zoom : zoom.querySelector('img');
      if (img?.src) this.showImage(img.src);
      return;
    }
    const audio = target.closest<HTMLElement>('[data-kind]');
    if (audio) this.play(audio);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(`.rr-ark-option, [data-kind], ${ZOOMABLE}`);
    if (!el) return;
    e.preventDefault();
    el.click();
  };

  /** Mark `option` selected and show only the lines of its branch. */
  private selectOption(option: HTMLElement): void {
    const chapter = option.closest('.rr-ark-chapter');
    const choice = option.dataset.choice;
    const value = option.dataset.value ?? '';
    if (!chapter || choice === undefined) return;
    option.parentElement?.querySelectorAll('.rr-ark-option').forEach((o) => o.toggleClass('is-selected', o === option));
    chapter.querySelectorAll<HTMLElement>(`.rr-ark-branch[data-choice="${choice}"]`).forEach((line) => {
      const values = (line.dataset.values ?? '').split(' ');
      line.toggleClass('is-hidden', !values.includes(value));
    });
  }

  // --- Position and choices, shared with the visual-novel view ---------------

  /** `data-seg` of the first visible line at or below the top of the screen. */
  topSegment(): string | null {
    const top = this.scrollEl?.getBoundingClientRect().top ?? 0;
    for (const el of Array.from(this.contentEl.querySelectorAll<HTMLElement>('[data-seg]'))) {
      if (el.closest('.is-hidden')) continue;
      if (el.getBoundingClientRect().bottom > top + 1) return el.dataset.seg ?? null;
    }
    return null;
  }

  /** Scroll so the line with `data-seg="key"` (or its chapter, for a title) is at the top. */
  scrollToSegment(key: string): void {
    const scroll = this.scrollEl;
    if (!scroll) return;
    const [chapter, node, seg] = key.split(':');
    let el = this.contentEl.querySelector<HTMLElement>(`[data-seg="${key}"]`);
    if (!el && seg === '-1' && node === '0') el = this.contentEl.querySelector<HTMLElement>(`.rr-chapter[data-index="${chapter}"]`);
    if (!el || el.closest('.is-hidden')) return;
    scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  }

  /** Selected option per choice, keyed `chapter:choice` like the visual-novel view. */
  pickedChoices(): Map<string, string> {
    const out = new Map<string, string>();
    this.contentEl.querySelectorAll<HTMLElement>('.rr-ark-option.is-selected').forEach((o) => {
      const chapter = o.closest<HTMLElement>('.rr-chapter')?.dataset.index;
      if (chapter !== undefined && o.dataset.choice !== undefined) out.set(`${chapter}:${o.dataset.choice}`, o.dataset.value ?? '');
    });
    return out;
  }

  /** Show option `value`'s branch for choice `choice` of `chapter`. */
  selectChoice(chapter: number, choice: number, value: string): void {
    const option = this.contentEl.querySelector<HTMLElement>(
      `.rr-chapter[data-index="${chapter}"] .rr-ark-option[data-choice="${choice}"][data-value="${CSS.escape(value)}"]`,
    );
    if (option) this.selectOption(option);
  }

  /** A tap on a sound button or music bar. */
  private play(el: HTMLElement): void {
    const name = el.dataset.name ?? '';
    if (el.dataset.kind === 'sound') {
      if (!el.dataset.src) new Notice(`Track not available: ${name}`);
      else void new Audio(el.dataset.src).play().catch(() => new Notice(`Could not play ${name}`));
      return;
    }
    // Music: tapping the playing bar stops it; a bar still waiting on autoplay starts it.
    if (this.musicEl === el && this.music) {
      if (this.music.paused) void this.music.play().then(() => this.nowPlaying(el), () => {});
      else this.stopMusic();
      return;
    }
    this.startMusic(el, false);
  }

  /** Loop `el`'s track as the only music playing. */
  private startMusic(el: HTMLElement, auto: boolean): void {
    const name = el.dataset.name ?? '';
    const src = el.dataset.src;
    this.stopMusic();
    if (!src) {
      new Notice(`Track not available: ${name}`);
      return;
    }
    const audio = new Audio(src);
    audio.loop = true;
    this.music = audio;
    this.musicEl = el;
    el.addClass('is-playing');
    void audio.play().then(
      () => this.nowPlaying(el),
      () => {
        if (this.music !== audio) return;
        // Browsers block audio until the first tap; autoplay retries then.
        if (auto) return this.waitForGesture();
        this.stopMusic();
        new Notice(`Could not play ${name}`);
      },
    );
  }

  private nowPlaying(el: HTMLElement): void {
    new Notice(`♪ Now playing: ${el.dataset.name ?? ''}`);
  }

  private stopMusic(): void {
    this.music?.pause();
    this.music = null;
    this.musicEl?.removeClass('is-playing');
    this.musicEl = null;
  }

  // --- Autoplay --------------------------------------------------------------

  setAutoplay(on: boolean): void {
    if (on === this.autoplay) return;
    this.autoplay = on;
    if (on) {
      this.scrollEl?.addEventListener('scroll', this.onScroll, { passive: true });
      this.syncMusic();
      return;
    }
    this.scrollEl?.removeEventListener('scroll', this.onScroll);
    this.clearAutoTimer();
    this.autoMarker = null;
    this.stopMusic();
  }

  private onScroll = (): void => {
    this.clearAutoTimer();
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      this.syncMusic();
    }, AUTOPLAY_DEBOUNCE_MS);
  };

  private clearAutoTimer(): void {
    if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  /** Play the track of the last music marker above the middle of the screen. */
  syncMusic(): void {
    const scroll = this.scrollEl;
    if (!this.autoplay || !scroll) return;
    const line = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
    let current: HTMLElement | null = null;
    for (const marker of Array.from(this.contentEl.querySelectorAll<HTMLElement>(MUSIC_MARKERS))) {
      if (marker.closest('.is-hidden')) continue; // inside an unchosen branch
      if (marker.getBoundingClientRect().top > line) break;
      current = marker;
    }
    if (current === this.autoMarker) return;
    this.autoMarker = current;

    if (!current || current.classList.contains('rr-ark-music-stop')) {
      this.stopMusic();
    } else if (this.music && current.dataset.src && current.dataset.src === this.musicEl?.dataset.src) {
      // Same track again: keep it going, just move the playing mark.
      this.musicEl?.removeClass('is-playing');
      this.musicEl = current;
      current.addClass('is-playing');
    } else {
      this.startMusic(current, true);
    }
  }

  private waitForGesture(): void {
    if (this.awaitingGesture) return;
    this.awaitingGesture = true;
    this.contentEl.ownerDocument.addEventListener('pointerdown', this.onGesture, true);
  }

  private onGesture = (e: PointerEvent): void => {
    // A tap on the music bar itself is handled by play().
    if ((e.target as Element | null)?.closest?.('.rr-ark-music')) return;
    this.stopWaitingForGesture();
    const audio = this.music;
    const el = this.musicEl;
    if (audio && el && audio.paused) void audio.play().then(() => this.nowPlaying(el), () => {});
  };

  private stopWaitingForGesture(): void {
    this.awaitingGesture = false;
    this.contentEl.ownerDocument.removeEventListener('pointerdown', this.onGesture, true);
  }

  // --- Images ----------------------------------------------------------------

  /** Full-size view of a CG or the whole sprite behind a portrait; any tap or Escape closes it. */
  private showImage(src: string): void {
    this.closeImage();
    const doc = this.contentEl.ownerDocument;
    const box = doc.createElement('div');
    box.className = 'rr-ark-lightbox';
    const img = doc.createElement('img');
    img.src = src;
    box.appendChild(img);
    box.addEventListener('click', () => this.closeImage());
    doc.addEventListener('keydown', this.onLightboxKey, true);
    doc.body.appendChild(box);
    this.lightbox = box;
  }

  private onLightboxKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    this.closeImage();
  };

  private closeImage(): void {
    this.lightbox?.remove();
    this.lightbox = null;
    this.contentEl.ownerDocument.removeEventListener('keydown', this.onLightboxKey, true);
  }

  /** Show the reader's chosen name wherever the story says {@nickname}. */
  setNickname(name: string): void {
    this.contentEl.querySelectorAll('.rr-ark-nick').forEach((el) => el.setText(name));
  }

  destroy(): void {
    this.setAutoplay(false);
    this.stopWaitingForGesture();
    this.stopMusic();
    this.closeImage();
    this.contentEl.removeEventListener('click', this.onClick);
    this.contentEl.removeEventListener('keydown', this.onKey);
  }
}
