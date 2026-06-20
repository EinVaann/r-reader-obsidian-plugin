#!/usr/bin/env python3
"""
Declare a cover image in EPUB files that lack one.

Many EPUBs (e.g. some light-novel volumes) show a cover page but never declare
it in the OPF, so standards-based readers — including foliate-js / R Reader —
find no cover (`getCover()` returns null).

This script finds the cover image (the first image on the first reading-order
page, falling back to the first image resource) and declares it both ways:
  * EPUB 3:  adds `properties="cover-image"` to that manifest item
  * EPUB 2:  adds `<meta name="cover" content="<id>"/>` to the metadata

The original file is backed up next to it as `<name>.epub.bak` (unless it
already exists), then rewritten in place with the `mimetype` entry kept first
and uncompressed, as the spec requires.

Usage:
    python3 set-epub-cover.py "<file.epub>" ["<file2.epub>" ...]
    python3 set-epub-cover.py "<folder>"        # all .epub under it (recursive)
    python3 set-epub-cover.py --force "<file>"   # re-declare even if one exists
    python3 set-epub-cover.py --dry-run "<file>" # report only, write nothing
"""

import os
import posixpath
import re
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET

OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container"
XLINK_NS = "http://www.w3.org/1999/xlink"


def q(ns, tag):
    return f"{{{ns}}}{tag}"


def find_opf_path(z):
    root = ET.fromstring(z.read("META-INF/container.xml"))
    for rf in root.iter(q(CONTAINER_NS, "rootfile")):
        if rf.get("full-path"):
            return rf.get("full-path")
    raise RuntimeError("no rootfile in META-INF/container.xml")


def first_image_in_html(content):
    """First <img src> / <image xlink:href> reference in an XHTML doc."""
    try:
        root = ET.fromstring(content)
        for el in root.iter():
            tag = el.tag.split("}")[-1].lower()
            if tag == "img" and el.get("src"):
                return el.get("src")
            if tag == "image":
                href = el.get(q(XLINK_NS, "href")) or el.get("href")
                if href:
                    return href
    except ET.ParseError:
        pass
    # Tolerant fallback for non-well-formed XHTML.
    for pat in (rb'<img[^>]+src=["\']([^"\']+)', rb'xlink:href=["\']([^"\']+)'):
        m = re.search(pat, content, re.I)
        if m:
            return m.group(1).decode("utf-8", "replace")
    return None


def resolve(opf_dir, href):
    return posixpath.normpath(posixpath.join(opf_dir, href))


def pick_cover_id(z, opf_root, opf_dir, manifest):
    """Manifest id of the cover image: first image on the first spine page,
    else the first image resource."""
    spine = opf_root.find(q(OPF_NS, "spine"))
    if spine is not None:
        itemref = spine.find(q(OPF_NS, "itemref"))
        if itemref is not None and itemref.get("idref") in manifest:
            href, _mt, _el = manifest[itemref.get("idref")]
            doc_path = resolve(opf_dir, href)
            try:
                img = first_image_in_html(z.read(doc_path))
            except KeyError:
                img = None
            if img:
                img_path = posixpath.normpath(
                    posixpath.join(posixpath.dirname(doc_path), img)
                )
                for iid, (ihref, _imt, _iel) in manifest.items():
                    if resolve(opf_dir, ihref) == img_path:
                        return iid
    # Fallback: first image-type resource in manifest order.
    for iid, (_href, mt, _el) in manifest.items():
        if mt and mt.startswith("image/"):
            return iid
    return None


def already_has_cover(opf_root, manifest_el, metadata):
    for it in manifest_el.findall(q(OPF_NS, "item")):
        if "cover-image" in (it.get("properties") or "").split():
            return True
    for m in metadata.findall(q(OPF_NS, "meta")):
        if m.get("name") == "cover":
            return True
    return False


def process(path, force=False, dry_run=False):
    # Keep OPF as the (unprefixed) default namespace, like typical EPUBs.
    ET.register_namespace("", OPF_NS)
    ET.register_namespace("dc", DC_NS)

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        opf_path = find_opf_path(z)
        opf_dir = posixpath.dirname(opf_path)
        opf_root = ET.fromstring(z.read(opf_path))

        manifest_el = opf_root.find(q(OPF_NS, "manifest"))
        metadata = opf_root.find(q(OPF_NS, "metadata"))
        if manifest_el is None or metadata is None:
            return f"SKIP  {path}  (no manifest/metadata)"

        manifest = {}
        for item in manifest_el.findall(q(OPF_NS, "item")):
            manifest[item.get("id")] = (item.get("href"), item.get("media-type"), item)

        if already_has_cover(opf_root, manifest_el, metadata) and not force:
            return f"OK    {path}  (already declares a cover)"

        cover_id = pick_cover_id(z, opf_root, opf_dir, manifest)
        if not cover_id:
            return f"SKIP  {path}  (no image resource found)"

        href, _mt, el = manifest[cover_id]

        # EPUB 3: properties="cover-image" (only one item may carry it).
        for it in manifest_el.findall(q(OPF_NS, "item")):
            props = [p for p in (it.get("properties") or "").split() if p != "cover-image"]
            if props:
                it.set("properties", " ".join(props))
            elif it.get("properties") is not None:
                del it.attrib["properties"]
        props = el.get("properties").split() if el.get("properties") else []
        props.append("cover-image")
        el.set("properties", " ".join(props))

        # EPUB 2: <meta name="cover" content="id"/>
        for m in list(metadata.findall(q(OPF_NS, "meta"))):
            if m.get("name") == "cover":
                metadata.remove(m)
        meta = ET.SubElement(metadata, q(OPF_NS, "meta"))
        meta.set("name", "cover")
        meta.set("content", cover_id)

        new_opf = ET.tostring(opf_root, encoding="utf-8", xml_declaration=True)
        blobs = {n: z.read(n) for n in names}

    if dry_run:
        return f"WOULD {path}  → cover = '{href}' (id={cover_id})"

    blobs[opf_path] = new_opf

    bak = path + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)

    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w") as zout:
        # mimetype must be first and stored (uncompressed).
        if "mimetype" in blobs:
            zi = zipfile.ZipInfo("mimetype")
            zi.compress_type = zipfile.ZIP_STORED
            zout.writestr(zi, blobs["mimetype"])
        for n in names:
            if n == "mimetype":
                continue
            zout.writestr(n, blobs[n], zipfile.ZIP_DEFLATED)
    os.replace(tmp, path)
    return f"FIXED {path}  → cover = '{href}' (id={cover_id})"


def iter_targets(args):
    for a in args:
        if os.path.isdir(a):
            for root, _dirs, files in os.walk(a):
                for f in files:
                    if f.lower().endswith(".epub"):
                        yield os.path.join(root, f)
        else:
            yield a


def main(argv):
    force = "--force" in argv
    dry_run = "--dry-run" in argv
    paths = [a for a in argv[1:] if not a.startswith("--")]
    if not paths:
        print(__doc__)
        return 1
    for path in iter_targets(paths):
        try:
            print(process(path, force=force, dry_run=dry_run))
        except Exception as e:  # noqa: BLE001 — report and continue the batch
            print(f"ERROR {path}  — {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
