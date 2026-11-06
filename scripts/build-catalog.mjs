#!/usr/bin/env node
// Builds data/catalog.json from the category folders (tools/, games/, teaching/, research/).
//
// Every sub-folder of a category folder becomes one entry, and so does any loose .html file
// directly inside it. Nothing has to be registered by hand: drop a folder with an index.html
// into games/ and it appears on the homepage. An optional meta.json in the folder adds a
// bilingual title, a description and extra pages (see README.md).
//
// Run locally with:  node scripts/build-catalog.mjs
// The GitHub Action in .github/workflows/catalog.yml runs it on every push.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'data/catalog.config.json'), 'utf8'));
const COVER_NAMES = ['cover.webp', 'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.gif'];
const THUMB_NAMES = ['thumb.webp', 'thumb.jpg', 'thumb.jpeg', 'thumb.png'];

const read = (p) => readFileSync(p, 'utf8');
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const skip = (name) => name.startsWith('.') || name.startsWith('_');

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, ' ').trim();
}

function readHtmlInfo(file) {
  const html = read(file).replace(/^﻿/, '');
  const pick = (re) => { const m = html.match(re); return m ? decode(m[1]) : ''; };
  return {
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description:
      pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
      pick(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i) ||
      pick(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i),
    lang: pick(/<html[^>]*\slang=["']([^"']+)["']/i),
  };
}

function bilingual(meta, key, fallback) {
  // Accepts "title": "..." + "title_zh": "...", or "title": { "en": "...", "zh": "..." }.
  const v = meta[key];
  if (v && typeof v === 'object') return { en: v.en || v.zh || fallback, zh: v.zh || v.en || fallback };
  const en = v || '';
  const zh = meta[`${key}_zh`] || '';
  if (en || zh) return { en: en || zh, zh: zh || en };
  return { en: fallback || '', zh: fallback || '' };
}

function prettySlug(slug) {
  return slug.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Folders with "hidden": true in meta.json. The homepage needs their names too, so that
// its live check on GitHub does not mistake them for new tools.
const hidden = [];

let gitOk = true;
function git(args) {
  if (!gitOk) return '';
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    gitOk = false;
    return '';
  }
}
// The day the entry file first entered the repository (following renames), and its last change.
function dates(entryPath, folderPath) {
  const added = git(['log', '--follow', '--diff-filter=A', '--format=%cs', '--', entryPath]).split('\n').filter(Boolean).pop() || '';
  const updated = git(['log', '-1', '--format=%cs', '--', folderPath]) || '';
  return { added, updated };
}

function firstExisting(dir, names) {
  return names.find((n) => existsSync(join(dir, n))) || '';
}

function buildEntry(cat, name) {
  const catDir = join(ROOT, cat.folder);
  const full = join(catDir, name);
  let meta = {};
  let entry;
  let base; // URL of the folder (or of the loose file)
  let folderRel;

  if (isDir(full)) {
    const metaFile = join(full, 'meta.json');
    if (existsSync(metaFile)) {
      try { meta = JSON.parse(read(metaFile)); }
      catch (e) { console.warn(`! ${cat.folder}/${name}/meta.json is not valid JSON: ${e.message}`); }
    }
    const htmlFiles = readdirSync(full).filter((f) => /\.html?$/i.test(f)).sort();
    entry = meta.entry || (htmlFiles.includes('index.html') ? 'index.html' : htmlFiles[0]);
    if (!entry || !existsSync(join(full, entry))) return null;
    base = `${cat.folder}/${name}/`;
    folderRel = `${cat.folder}/${name}`;
  } else if (/\.html?$/i.test(name) && name.toLowerCase() !== 'index.html') {
    entry = name;
    base = `${cat.folder}/`;
    folderRel = `${cat.folder}/${name}`;
  } else {
    return null;
  }

  if (meta.hidden) { hidden.push(`${cat.id}/${name.replace(/.html?$/i, "")}`); return null; }

  const info = readHtmlInfo(join(ROOT, base, entry));
  const slug = name.replace(/\.html?$/i, '');
  const href = base + (entry === 'index.html' ? '' : entry);
  const dir = isDir(full) ? full : null;
  const cover = meta.cover || (dir ? firstExisting(dir, COVER_NAMES) : '');
  const thumb = meta.thumb || (dir ? firstExisting(dir, THUMB_NAMES) : '');
  const { added, updated } = dates(`${base}${entry}`, folderRel);

  return {
    id: `${cat.id}/${slug}`,
    slug,
    href,
    title: bilingual(meta, 'title', info.title || prettySlug(slug)),
    description: bilingual(meta, 'description', info.description),
    needs: bilingual(meta, 'needs', ''),
    lang: meta.lang || (info.lang ? (/^zh/i.test(info.lang) ? 'zh' : info.lang.slice(0, 2).toLowerCase()) : ''),
    cover: cover ? base + cover : '',
    thumb: thumb ? base + thumb : '',
    pages: (meta.pages || []).map((p) => ({
      title: bilingual(p, 'title', p.href),
      href: base + p.href,
    })),
    order: Number.isFinite(meta.order) ? meta.order : 999,
    added,
    updated,
  };
}

const catalog = {
  repo: config.repo,
  branch: config.branch,
  categories: config.categories.map((cat) => {
    const catDir = join(ROOT, cat.folder);
    const names = isDir(catDir) ? readdirSync(catDir).filter((n) => !skip(n)) : [];
    const items = names
      .map((n) => buildEntry(cat, n))
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || (b.added || '').localeCompare(a.added || '') || a.title.en.localeCompare(b.title.en));
    return {
      id: cat.id,
      folder: cat.folder,
      name: { en: cat.name, zh: cat.name_zh || cat.name },
      blurb: { en: cat.blurb || '', zh: cat.blurb_zh || cat.blurb || '' },
      items,
    };
  }),
};
catalog.hidden = hidden.sort();

const out = join(ROOT, 'data/catalog.json');
const json = JSON.stringify(catalog, null, 2) + '\n';
const before = existsSync(out) ? read(out) : '';
if (json !== before) writeFileSync(out, json);
const total = catalog.categories.reduce((n, c) => n + c.items.length, 0);
console.log(`catalog: ${total} entries in ${catalog.categories.length} categories${json === before ? ' (unchanged)' : ' → data/catalog.json'}`);
for (const c of catalog.categories) console.log(`  ${c.folder}/  ${c.items.map((i) => i.slug).join(', ')}`);
