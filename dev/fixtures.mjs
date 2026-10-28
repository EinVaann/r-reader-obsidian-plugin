// Deterministic fixtures for the browser harness: a small EPUB, an `.ark`
// story, and SVG media. Generated at build time so no binaries live in git.
import { deflateRawSync } from 'zlib';

// --- Minimal zip writer (EPUB = zip with an uncompressed `mimetype` first) ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `entries`: [name, string | Buffer][]; the first is stored, the rest deflated. */
export function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  entries.forEach(([name, content], i) => {
    const data = Buffer.from(content);
    const store = i === 0;
    const body = store ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(store ? 0 : 8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  });
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBuf, end]);
}

// --- EPUB -------------------------------------------------------------------

const WORDS =
  'the harbor lantern glowed over quiet water while gulls circled the old pier and sailors mended nets beneath a pale sky ' +
  'stories drifted from the tavern where travellers traded maps and rumours of islands beyond the fog';
/** Deterministic filler paragraph number `n`. */
function para(n, len = 70) {
  const w = WORDS.split(' ');
  const out = [];
  for (let i = 0; i < len; i++) out.push(w[(n * 7 + i * 3) % w.length]);
  const s = out.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

const CHAPTERS = [
  { id: 'c1', title: 'Chapter 1: The Harbor', extra: '<blockquote><p>Every harbor keeps a secret.</p></blockquote>' },
  { id: 'c2', title: 'Chapter 2: The Lantern', extra: '<figure><img src="images/lantern.svg" alt="A lantern"/></figure>' },
  { id: 'c3', title: 'Chapter 3: The Fog', extra: '<ul><li>A compass</li><li>A rope</li><li>A lantern</li></ul>' },
];

function xhtml(ch, i) {
  const ps = Array.from({ length: 14 }, (_, n) => `<p>${para(i * 20 + n)}</p>`);
  ps.splice(3, 0, ch.extra);
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${ch.title}</title><style>p{color:red}</style></head>
<body><h1 id="${ch.id}">${ch.title}</h1>${ps.join('\n')}</body></html>`;
}

const LANTERN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
<rect width="240" height="160" fill="#203040"/><circle cx="120" cy="80" r="40" fill="#f2c14e"/>
<rect x="105" y="30" width="30" height="12" fill="#888"/></svg>`;

export function makeEpub() {
  const manifest = CHAPTERS.map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = CHAPTERS.map((c) => `<itemref idref="${c.id}"/>`).join('');
  const nav = CHAPTERS.map((c) => `<li><a href="${c.id}.xhtml">${c.title}</a></li>`).join('');
  return zip([
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ],
    [
      'OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:rr-e2e-harbor</dc:identifier><dc:title>The Harbor Lantern</dc:title>
<dc:creator>Ada Tester</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="img" href="images/lantern.svg" media-type="image/svg+xml"/>${manifest}</manifest>
<spine>${spine}</spine></package>`,
    ],
    [
      'OEBPS/nav.xhtml',
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`,
    ],
    ['OEBPS/images/lantern.svg', LANTERN_SVG],
    ...CHAPTERS.map((c, i) => [`OEBPS/${c.id}.xhtml`, xhtml(c, i)]),
  ]);
}

// --- .ark story + media ------------------------------------------------------

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** Media files keyed by path under the assets folder. */
export const MEDIA_FILES = {
  'bg/room.svg': svg(1280, 720, '<rect width="1280" height="720" fill="#3b4a5a"/><rect y="480" width="1280" height="240" fill="#2a3440"/>'),
  'cgs/avg_1.svg': svg(1280, 720, '<rect width="1280" height="720" fill="#5a3b4a"/><circle cx="640" cy="360" r="200" fill="#e0b0c0"/>'),
  'sprites/medic.svg': svg(400, 800, '<rect x="100" y="80" width="200" height="720" rx="90" fill="#6fa8dc"/>'),
  'sprites/amiya.svg': svg(400, 800, '<rect x="100" y="80" width="200" height="720" rx="90" fill="#c27ba0"/>'),
};

export const MEDIA_TABLE = {
  'bg:room': { status: 'ok', local_path: 'bg/room.svg' },
  'cgs:avg_1': { status: 'ok', local_path: 'cgs/avg_1.svg' },
  'sprites:char_medic': { status: 'ok', local_path: 'sprites/medic.svg' },
  'sprites:char_amiya': { status: 'ok', local_path: 'sprites/amiya.svg' },
  'music:$theme_loop': { status: 'missing' },
};

const say = (speaker, text, extra = {}) => ({ segment_type: 'dialogue', speaker, text, ...extra });
const dir = (action, params = {}) => ({ segment_type: 'stage_direction', action, params });

export const STORY = {
  format: 'ark',
  version: 1,
  eventId: 'e2e_0',
  eventName: 'Harbor Watch',
  chapters: [
    {
      id: 'c0',
      title: 'Prologue',
      nodes: [
        {
          nodeId: 'n0',
          avgTag: 'Before Dawn',
          segments: [
            dir('PlayMusic', { key: '$theme_loop' }),
            dir('Background', { image: 'room' }),
            { segment_type: 'narration', text: 'The rain had not stopped for three days.' },
            say('Medic', 'You are finally awake, {@nickname}.', { character_sprite: 'char_medic', character_sprite_2: 'char_amiya', character_focus: 1 }),
            say('Amiya', 'Can you stand? We need to <i>move</i>.', { character_sprite: 'char_medic', character_sprite_2: 'char_amiya', character_focus: 2 }),
            { segment_type: 'choice', speaker: 'Doctor', choices: [{ text: 'Where are we?', value: '1' }, { text: '...', value: '2' }] },
            say('Amiya', 'Somewhere safe, for now.', { choice_values: ['1'], character_sprite: 'char_amiya' }),
            say('Amiya', 'Take your time.', { choice_values: ['2'], character_sprite: 'char_amiya' }),
            dir('Image', { image: 'avg_1' }),
            { segment_type: 'narration', text: 'A memory flickers, then fades.' },
            dir('Image', {}),
            say('Medic', 'Let us go.', { character_sprite: 'char_medic' }),
          ],
        },
      ],
    },
    {
      id: 'c1',
      title: 'Chapter One',
      nodes: [{ nodeId: 'n1', avgTag: 'Operation', segments: [say('Ace', 'Move out, everyone.'), { segment_type: 'narration', text: 'The gates open.' }] }],
    },
  ],
};
