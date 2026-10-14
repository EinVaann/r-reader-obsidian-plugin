# R Reader

A polished, mobile-friendly **EPUB reader for Obsidian** — read whole books with
continuous scrolling, highlight and annotate text, bookmark your place, search inside
the book, and browse your library with covers. Everything lives in your vault and syncs
across devices.

> EPUBs, plus `.ark` story scripts (see below). PDF and other formats are intentionally out of scope.

---

## Features

- **Continuous whole-book scrolling** — the entire EPUB renders in one smooth scroll, not
  one chapter at a time.
- **Highlights & annotations** — select text, pick a color (yellow / green / blue / pink),
  and optionally attach a note. Tap a highlight to recolor, edit the note, or delete it.
- **Library view** — a grid of every EPUB in your vault with cover art, title/author,
  reading progress, and highlight counts. Click a book to open it.
- **Searchable table of contents** — a dedicated TOC with a filter box: a popover on
  desktop, a full-screen overlay on mobile for easy chapter picking.
- **In-book full-text search** — search across the whole book and jump straight to a match,
  which is briefly flashed so you can find it.
- **Named bookmarks** — drop bookmarks anywhere and jump back to them from the quick menu.
- **Export reading notes** — write all your highlights (grouped by chapter, with notes) and
  bookmarks to a Markdown note in your vault.
- **Themes & fonts** — light / dark / sepia, adjustable font size and line height, and a
  font picker with embedded Libron (a serif tuned for reading on screens), Fira Code and
  Bricolage Grotesque (no install needed).
- **Mobile-first** — floating bars, a full-width progress slider, tap-to-scroll, and an
  immersive full-screen mode that hides Obsidian's own chrome.
- **Fast re-opens** — books are cached in memory after the first load, so reopening is
  instant. First open is progressive: early chapters become readable while the rest builds.
- **Cross-device visibility** — EPUB files show up on every device automatically (the plugin
  enables Obsidian's "Detect all file extensions" via its own synced setting).
- **`.ark` stories** — game story scripts read as a script: scene art, speakers with round
  portraits, music bars, sound buttons, and choices that reveal their own branch.

---

## `.ark` stories

An `.ark` file is one story (JSON with `"format": "ark"`) holding its chapters in order.
Images and audio live in a separate **assets folder** shared by every story, holding
`media.json` (media ID → file) and the media files. Point the reader at it with the
*Assets folder* setting (under *Arknights stories* in the settings).

- **Library**: an *Arknights* tab lists stories by storyline (from their folders) in reading
  order, with recently read stories on top.
- **Two views**: a scrolling script, or a visual-novel stage (background, characters, the
  line at the bottom). Switch with the button in the top bar; your place is kept.
- **Visual-novel taps**: top/left side goes back, right/bottom side continues, the center
  shows or hides the bars. *Log* lists the lines read; tap one to go back to it.
- **Choices**: the first option is shown; tap another to read its branch instead.
- **Music**: in the script view it plays as you scroll to each scene (turn off *Autoplay
  music* to play only on tap); the stage plays it as the script says. The speaker button in
  the top bar turns music off (and on) in both views; sound effects keep playing.
- **Images**: in the script view, tap a scene image or portrait to see it full size.
- `{@nickname}` in the script uses the *Nickname* setting (default "Doctor").
- Highlights are off for stories; bookmarks, search and progress work as in EPUBs.

---

## Install (via BRAT)

1. Install the **BRAT** community plugin.
2. In BRAT: *Add Beta Plugin* → `EinVaann/r-reader-obsidian-plugin`.
3. Enable **R Reader** in *Settings → Community plugins*.

Updates: BRAT can auto-update, or use *Check for updates* in BRAT.

---

## Usage

- **Open a book**: click any `.epub` file in your vault, or open the **Library** from the
  ribbon (book icon) and click a cover.
- **Highlight**: select text → pick a color in the floating toolbar. Tap *Note* to also add
  a note. Tap an existing highlight to edit or delete it.
- **Table of contents**: tap the list icon in the top bar (or run *Open table of contents*),
  then type to filter chapters.
- **Search**: tap the search icon (or run *Search in book*), type at least two characters,
  and click a result to jump to it.
- **Bookmark**: run *Add bookmark*, or use **+ Add** in the reader settings menu (gear icon).
  Bookmarks are listed there for one-tap jumps.
- **Export notes**: run *Export reading notes to a note*, or use **Export to note** in the
  settings menu. A Markdown file is written to your notes folder (see settings).
- **Immersive reading (mobile)**: tap the center of the screen to hide/show the bars and
  Obsidian's chrome.

---

## Commands

- Open R Reader library
- Open table of contents
- Search in book
- Add bookmark
- Export reading notes to a note
- Cycle default highlight color
- Toggle full-screen reading (hide bars)
- Scroll down / up (next / previous screen)
- Open reader settings menu
- Cycle theme · Increase / Decrease font size
- Clear EPUB render cache

---

## Settings

| Setting | Description |
|---|---|
| Theme | Light, Dark, or Sepia |
| Font size / Line height | Reading typography |
| Scroll mode | Continuous (paginated reserved for future) |
| Default highlight color | Color used when you create a highlight |
| Reading data file | Vault file for progress, highlights and bookmarks (empty = `data.json`); *Move* merges with an existing file |
| Notes export folder | Where *Export reading notes* writes Markdown (default `R Reader Notes`) |
| Close menu after chapter jump | Close the TOC/menu after jumping |
| No image mode | Render text placeholders instead of images (faster/lighter) |
| Show EPUB files on all devices | Auto-enables "Detect all file extensions" |
| Touch-to-scroll / Hide bars on mobile | Mobile reading controls |
| Clear EPUB cache | Drop the in-memory render cache |

**Arknights stories (.ark)** — a separate section at the bottom of the settings:

| Setting | Description |
|---|---|
| Assets folder | Folder with `media.json` and the images and audio stories use |
| Default view | Open stories in the script (scroll) or visual-novel view |
| Nickname | Name used for `{@nickname}` in the script (default "Doctor") |
| Text speed | Visual-novel view: letters per second as a line types out (0 = at once) |
| Autoplay music | Script view: play each scene's music while scrolling |

---

## Where your data lives

Highlights, bookmarks, reading progress, and settings are all stored as structured JSON in
the plugin's own `data.json` (inside `.obsidian/plugins/r-reader/`). Because that file syncs
with your vault, your reading data follows you across devices. Exported notes are normal
Markdown files in your vault.

To keep reading data in a vault file instead (for example to sync it with a tool that skips
`.obsidian/`), set **Reading data file** to a path like `R Reader/reading-data.json` and press
*Move*. Settings stay in `data.json`. If the file already exists, the two are merged: per book
the more recently read position wins, and highlights and bookmarks are combined. The file is
read when the plugin loads, so reload Obsidian after it changes on another device.

---

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production build
npm run deploy   # build + copy main.js/manifest.json/styles.css into a test vault
```

The renderer uses [foliate-js](https://github.com/johnfactotum/foliate-js) (vendored as a
submodule) purely as an EPUB **parser**; rendering is a custom continuous DOM renderer with
no iframes (so there are no CSP/sandbox issues).

Libron (c) 2026 Nico Verbruggen, embedded under the SIL Open Font License 1.1 —
see https://github.com/nicoverbruggen/libron.
