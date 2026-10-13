import { Notice, setIcon } from 'obsidian';
import { formatText, trackName, type ArkStory, type MediaResolver } from '../renderChapter';
import { VnScript, type Choices, type Cursor, type Frame, type Step } from './script';

export interface VnOptions {
  nickname: string;
  /** Letters per second for typed-out text; 0 shows each line at once. */
  textSpeed: number;
  /** Music off (sound effects still play). */
  musicMuted: boolean;
  /** Center tap: show or hide the reader's bars. */
  onToggleChrome: () => void;
  /** A frame is shown (keeps the script view's position in step). */
  onFrame: (frame: Frame) => void;
  /** An option was picked (keeps the script view's branches in step). */
  onChoose: (chapter: number, choice: number, value: string) => void;
}

/**
 * Visual-novel view of a story: background and CG layers, characters, the
 * line at the bottom, choices, music and sounds. Tap the top/left side to go
 * back, the right/bottom side to continue, the center to toggle the bars.
 */
export class VnPlayer {
  private root: HTMLElement;
  private bgLayers: HTMLImageElement[];
  private bgFront = 0;
  private cgEl: HTMLImageElement;
  private charsEl: HTMLElement;
  private titleEl: HTMLElement;
  private boxEl: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private choicesEl: HTMLElement;
  private hintEl: HTMLElement;
  private logEl: HTMLElement | null = null;

  private script: VnScript;
  private history: Step[] = [];
  private choices: Choices;
  private typing: { timer: number; finish: () => void } | null = null;
  private music: { id: string; audio: HTMLAudioElement } | null = null;
  private shown: { bg: string | null; cg: string | null } = { bg: null, cg: null };

  constructor(
    host: HTMLElement,
    story: ArkStory,
    private resolve: MediaResolver,
    private opts: VnOptions,
    choices: Choices,
  ) {
    this.script = new VnScript(story);
    this.choices = new Map(choices);
    const doc = host.ownerDocument;
    const div = (cls: string, parent: HTMLElement): HTMLElement => {
      const el = doc.createElement('div');
      el.className = cls;
      parent.appendChild(el);
      return el;
    };
    const img = (cls: string, parent: HTMLElement): HTMLImageElement => {
      const el = doc.createElement('img');
      el.className = cls;
      el.alt = '';
      parent.appendChild(el);
      return el;
    };

    this.root = div('rr-vn', host);
    this.root.tabIndex = 0;
    const stage = div('rr-vn-stage', this.root);
    this.bgLayers = [img('rr-vn-bg', stage), img('rr-vn-bg', stage)];
    this.cgEl = img('rr-vn-cg', stage);
    this.charsEl = div('rr-vn-chars', stage);
    this.titleEl = div('rr-vn-title', stage);
    this.boxEl = div('rr-vn-box', stage);
    this.speakerEl = div('rr-vn-speaker', this.boxEl);
    this.textEl = div('rr-vn-text', this.boxEl);
    this.choicesEl = div('rr-vn-choices', this.boxEl);
    this.hintEl = div('rr-vn-hint', stage);

    const bar = div('rr-vn-toolbar', this.root);
    this.button(bar, 'undo-2', 'Back', () => this.back());
    this.button(bar, 'list', 'Log', () => this.toggleLog());

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('keydown', this.onKey);
  }

  private button(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const b = parent.ownerDocument.createElement('button');
    b.className = 'rr-vn-btn';
    b.setAttribute('aria-label', label);
    setIcon(b, icon);
    b.appendChild(parent.ownerDocument.createTextNode(label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    parent.appendChild(b);
  }

  /** Start at the first frame at or after `at` (the story start when null). */
  start(at: Cursor | null): void {
    const target = at ?? { chapter: 0, node: 0, seg: -1 };
    this.history = this.script.replayTo(target, this.choices);
    if (this.history.length === 0) {
      new Notice('R Reader: nothing to show in this story');
      return;
    }
    this.show(false);
    this.root.focus({ preventScroll: true });
  }

  setOptions(patch: Partial<Pick<VnOptions, 'nickname' | 'textSpeed' | 'musicMuted'>>): void {
    const mutedChanged = patch.musicMuted !== undefined && patch.musicMuted !== this.opts.musicMuted;
    Object.assign(this.opts, patch);
    if (mutedChanged) this.setMusic(this.current()?.stage.music ?? null);
  }

  /** Tap: finish the typing line, else go to the next frame. */
  advance(): void {
    if (this.typing) {
      this.typing.finish();
      return;
    }
    const last = this.history[this.history.length - 1];
    if (!last || last.frame.stop.kind === 'choice') return; // pick an option to go on
    this.forward();
  }

  private forward(): void {
    const last = this.history[this.history.length - 1];
    const step = this.script.next(last.next, last.run, this.choices);
    if (!step) {
      new Notice('R Reader: end of story');
      return;
    }
    this.history.push(step);
    this.show(true);
  }

  back(): void {
    if (this.history.length < 2) return;
    this.history.pop();
    this.show(false);
  }

  private choose(value: string): void {
    const last = this.history[this.history.length - 1];
    if (last?.frame.stop.kind !== 'choice') return;
    const [chapter, n] = last.frame.stop.choice.split(':').map(Number);
    this.choices.set(last.frame.stop.choice, value);
    this.opts.onChoose(chapter, n, value);
    this.forward();
  }

  // --- Rendering -------------------------------------------------------------

  private show(arriving: boolean): void {
    const { frame } = this.history[this.history.length - 1];
    this.stopTyping();
    this.setBackground(frame.stage.bg);
    this.setCg(frame.stage.cg);
    this.setMusic(frame.stage.music);
    if (arriving) for (const id of frame.sounds) this.playSound(id);

    const stop = frame.stop;
    this.titleEl.empty();
    this.choicesEl.empty();
    this.speakerEl.empty();
    this.textEl.empty();
    this.root.toggleClass('is-title', stop.kind === 'title');
    this.boxEl.toggleClass('is-narration', stop.kind === 'line' && stop.narration);

    if (stop.kind === 'title') {
      this.setCharacters([], null);
      this.titleEl.createDiv({ cls: 'rr-vn-title-main', text: stop.title });
      if (stop.subtitle) this.titleEl.createDiv({ cls: 'rr-vn-title-sub', text: stop.subtitle });
      this.hintEl.toggleClass('is-visible', true);
    } else if (stop.kind === 'line') {
      this.setCharacters(stop.sprites, stop.focus);
      this.speakerEl.setText(stop.speaker ?? '');
      this.typeText(formatText(stop.text, this.opts.nickname));
    } else {
      this.speakerEl.setText(stop.speaker);
      stop.options.forEach((o, i) => {
        const b = this.choicesEl.createEl('button', { cls: 'rr-vn-option' });
        b.createSpan({ cls: 'rr-vn-option-num', text: String(i + 1) });
        b.createSpan().innerHTML = formatText(o.text, this.opts.nickname);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.choose(o.value);
        });
      });
      this.hintEl.toggleClass('is-visible', false);
    }
    this.opts.onFrame(frame);
    if (this.logEl) this.renderLog();
  }

  private setBackground(id: string | null): void {
    if (id === this.shown.bg) return;
    this.shown.bg = id;
    const url = id ? this.resolve(id) : null;
    const back = this.bgLayers[1 - this.bgFront];
    const front = this.bgLayers[this.bgFront];
    if (url) {
      back.src = url;
      back.addClass('is-shown');
      front.removeClass('is-shown');
      this.bgFront = 1 - this.bgFront;
    } else {
      front.removeClass('is-shown');
    }
  }

  private setCg(id: string | null): void {
    if (id === this.shown.cg) return;
    this.shown.cg = id;
    const url = id ? this.resolve(id) : null;
    if (url) this.cgEl.src = url;
    this.cgEl.toggleClass('is-shown', !!url);
  }

  private setCharacters(sprites: string[], focus: number | null): void {
    const urls = sprites.map((id) => this.resolve(id));
    const current = Array.from(this.charsEl.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    if (urls.length !== current.length || urls.some((u, i) => u !== current[i])) {
      this.charsEl.empty();
      urls.forEach((url) => {
        const el = this.charsEl.createEl('img', { cls: 'rr-vn-char' });
        el.alt = '';
        if (url) el.src = url;
      });
    }
    this.charsEl.dataset.count = String(urls.length);
    this.charsEl.querySelectorAll('img').forEach((el, i) => el.toggleClass('is-dim', focus !== null && focus !== i));
  }

  /** Show `html`, typed out letter by letter when a text speed is set. */
  private typeText(html: string): void {
    this.textEl.innerHTML = html;
    this.hintEl.toggleClass('is-visible', false);
    const done = (): void => {
      this.typing = null;
      this.hintEl.toggleClass('is-visible', true);
    };
    const cps = this.opts.textSpeed;
    if (cps <= 0) return done();

    const walker = this.textEl.ownerDocument.createTreeWalker(this.textEl, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; full: string }[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push({ node: n as Text, full: n.textContent ?? '' });
    nodes.forEach((n) => (n.node.textContent = ''));
    let i = 0;
    let shown = 0;
    const finish = (): void => {
      window.clearInterval(timer);
      nodes.forEach((n) => (n.node.textContent = n.full));
      done();
    };
    const timer = window.setInterval(() => {
      const n = nodes[i];
      if (!n) return finish();
      shown++;
      n.node.textContent = n.full.slice(0, shown);
      if (shown >= n.full.length) {
        i++;
        shown = 0;
      }
    }, 1000 / cps);
    this.typing = { timer, finish };
  }

  private stopTyping(): void {
    if (this.typing) window.clearInterval(this.typing.timer);
    this.typing = null;
  }

  // --- Audio -----------------------------------------------------------------

  private setMusic(id: string | null): void {
    if (this.opts.musicMuted) id = null;
    if ((this.music?.id ?? null) === id) return;
    this.music?.audio.pause();
    this.music = null;
    if (!id) return;
    const url = this.resolve(id);
    const name = trackName(id.replace(/^music:\$?/, ''));
    if (!url) {
      new Notice(`Track not available: ${name}`);
      return;
    }
    const audio = new Audio(url);
    audio.loop = true;
    this.music = { id, audio };
    void audio.play().then(
      () => new Notice(`♪ Now playing: ${name}`),
      () => {
        /* blocked until the first tap; the next frame retries */
        if (this.music?.audio === audio) this.music = null;
      },
    );
  }

  private playSound(id: string): void {
    const url = this.resolve(id);
    if (url) void new Audio(url).play().catch(() => {});
  }

  // --- Input -----------------------------------------------------------------

  private onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest('button, .rr-vn-log')) return;
    const rect = this.root.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (Math.abs(x - 0.5) < 1 / 6 && Math.abs(y - 0.5) < 1 / 6) this.opts.onToggleChrome();
    else if (x + y < 1) this.back(); // top / left side
    else this.advance(); // right / bottom side
  };

  private onKey = (e: KeyboardEvent): void => {
    const last = this.history[this.history.length - 1]?.frame.stop;
    if (last?.kind === 'choice' && /^[1-9]$/.test(e.key)) {
      const option = last.options[Number(e.key) - 1];
      if (option) this.choose(option.value);
    } else if (['ArrowRight', 'ArrowDown', ' ', 'Enter'].includes(e.key)) {
      this.advance();
    } else if (['ArrowLeft', 'ArrowUp', 'Backspace'].includes(e.key)) {
      this.back();
    } else if (e.key === 'Escape' && this.logEl) {
      this.toggleLog();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // --- Log -------------------------------------------------------------------

  private toggleLog(): void {
    if (this.logEl) {
      this.logEl.remove();
      this.logEl = null;
      return;
    }
    this.logEl = this.root.createDiv({ cls: 'rr-vn-log' });
    this.renderLog();
  }

  /** Lines read so far in this session; tap one to go back to it. */
  private renderLog(): void {
    const log = this.logEl;
    if (!log) return;
    log.empty();
    const head = log.createDiv({ cls: 'rr-vn-log-head', text: 'Log' });
    const close = head.createEl('button', { cls: 'rr-vn-btn', attr: { 'aria-label': 'Close log' } });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.toggleLog());
    const list = log.createDiv({ cls: 'rr-vn-log-list' });
    this.history.forEach((step, i) => {
      const stop = step.frame.stop;
      if (stop.kind === 'title') return;
      const item = list.createDiv({ cls: 'rr-vn-log-item' });
      if (stop.kind === 'line') {
        if (stop.speaker) item.createDiv({ cls: 'rr-vn-log-speaker', text: stop.speaker });
        item.createDiv({ cls: 'rr-vn-log-text' }).innerHTML = formatText(stop.text, this.opts.nickname);
      } else {
        const picked = this.choices.get(stop.choice) ?? stop.options[0]?.value;
        const option = stop.options.find((o) => o.value === picked);
        item.createDiv({ cls: 'rr-vn-log-speaker', text: stop.speaker });
        item.createDiv({ cls: 'rr-vn-log-text' }).innerHTML = formatText(option?.text ?? '', this.opts.nickname);
      }
      item.addEventListener('click', () => {
        this.history.length = i + 1;
        this.toggleLog();
        this.show(false);
      });
    });
    list.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  /** The frame on screen (for switching back to the script view). */
  current(): Frame | null {
    return this.history[this.history.length - 1]?.frame ?? null;
  }

  destroy(): void {
    this.stopTyping();
    this.music?.audio.pause();
    this.music = null;
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
