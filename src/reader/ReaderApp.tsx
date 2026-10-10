import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Icon } from '../react/Icon';
import { useReader, useReaderContext, useSettings } from './context';
import { BottomBar, PageIndicator, SideRail } from './Progress';
import { PANEL_TOGGLE, QuickSettings, SearchPanel, TocPanel } from './Panels';
import { SelectionLayer } from './Selection';
import type { ReaderPanel } from './store';

/**
 * The reader's frame: top bar, the book, progress (bottom bar or mobile side
 * rail), and the overlays. The book itself is not React's: `bookRef` is an
 * empty element handed to the EpubReader, which renders into it directly —
 * React never re-renders its children, so highlights, search marks and the
 * scroll position are left alone.
 */
export function ReaderApp({ title }: { title: string }) {
  const { actions, isMobile, highlights } = useReaderContext();
  const fontFamily = useSettings((s) => s.fontFamily);
  const fontSize = useSettings((s) => s.fontSize);
  const lineHeight = useSettings((s) => s.lineHeight);
  const sideRail = useSettings((s) => isMobile && s.progressBarPosition === 'right');
  const chromeHidden = useReader((s) => s.chromeHidden);
  const panel = useReader((s) => s.panel);
  const ready = useReader((s) => s.ready);
  const contentRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);

  // Hand the empty book element to the reader once, after the first render.
  useLayoutEffect(() => {
    if (contentRef.current && bookRef.current) actions.contentReady(contentRef.current, bookRef.current);
  }, [actions]);

  const cls = ['rr-reader-root'];
  if (isMobile) cls.push('rr-mobile');
  if (sideRail) cls.push('rr-progress-right');
  if (chromeHidden) cls.push('rr-chrome-hidden');
  const vars = {
    '--rr-font-family': fontFamily,
    '--rr-font-size': `${fontSize}px`,
    '--rr-line-height': String(lineHeight),
  } as CSSProperties;

  const bookContent = ready ? highlights.getContentEl() : null;

  return (
    <div className={cls.join(' ')} style={vars}>
      <TopBar title={title} />
      <div ref={contentRef} className="rr-content">
        <div ref={bookRef} className="rr-epub-container" />
        <Loading />
        <OpenError />
      </div>
      <BottomBar />
      {isMobile && <SideRail />}
      {panel === 'toc' && <TocPanel />}
      {panel === 'search' && <SearchPanel />}
      {panel === 'settings' && <QuickSettings />}
      {bookContent && <SelectionLayer contentEl={bookContent} />}
    </div>
  );
}

function TopBar({ title }: { title: string }) {
  const { actions } = useReaderContext();
  const label = useReader((s) => s.chapterLabel) || title;
  const panel = useReader((s) => s.panel);
  const toggle = (p: Exclude<ReaderPanel, null>): void => actions.setPanel(panel === p ? null : p);

  return (
    <div className="rr-topbar">
      {/* The chapter being read (updated while scrolling). */}
      <div className="rr-topbar-title" title={label}>
        {label}
      </div>
      <button className="rr-iconbtn clickable-icon rr-keep-mobile" aria-label="Table of contents" {...{ [PANEL_TOGGLE]: '' }} onClick={() => toggle('toc')}>
        <Icon name="list" />
      </button>
      <button className="rr-iconbtn clickable-icon rr-keep-mobile" aria-label="Search in book" {...{ [PANEL_TOGGLE]: '' }} onClick={() => toggle('search')}>
        <Icon name="search" />
      </button>
      <button className="rr-iconbtn clickable-icon" aria-label="Previous" onClick={() => actions.navigate(-1)}>
        <Icon name="chevron-left" />
      </button>
      <PageIndicator />
      <button className="rr-iconbtn clickable-icon" aria-label="Next" onClick={() => actions.navigate(1)}>
        <Icon name="chevron-right" />
      </button>
      <button className="rr-iconbtn clickable-icon rr-gear" aria-label="Reader settings" {...{ [PANEL_TOGGLE]: '' }} onClick={() => toggle('settings')}>
        <Icon name="settings-2" />
      </button>
    </div>
  );
}

function Loading() {
  const loading = useReader((s) => s.loading);
  return (
    <div className={loading ? 'rr-loading is-visible' : 'rr-loading'}>
      <div className="rr-spinner" />
      <div className="rr-loading-text">Loading…</div>
    </div>
  );
}

function OpenError() {
  const error = useReader((s) => s.error);
  return error ? <div className="rr-error">{error}</div> : null;
}
