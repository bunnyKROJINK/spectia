// Поиск на Modrinth. Их API открытый и не требует ключа.
// Документация: https://docs.modrinth.com/api/
//
// Чтобы поиск был «умным» (см. search.js), мы делаем две вещи сразу:
//  1. спрашиваем Modrinth по нескольким вариантам запроса;
//  2. держим под рукой список самых популярных проектов и сами ищем в нём
//     без учёта пробелов, знаков и по первым буквам.

import { queryVariants, matchScore } from './search.js';

const BASE = 'https://api.modrinth.com/v2';
const popularCache = new Map(); // "mod:26.3:fabric" → [проекты]

function facetsFor({ kind, gameVersion, loader }) {
  const facets = [[`project_type:${kind}`]];
  if (gameVersion && kind !== 'modpack') facets.push([`versions:${gameVersion}`]);
  // Загрузчик важен только для модов: шейдерам и текстурпакам он не нужен.
  if (kind === 'mod' && loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  return JSON.stringify(facets);
}

function toResult(h) {
  return {
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    icon: h.icon_url || '',
    url: `https://modrinth.com/${h.project_type}/${h.slug}`,
  };
}

async function rawSearch(opts, query, limit = 20, offset = 0) {
  const params = new URLSearchParams({
    query: query || '',
    limit: String(limit),
    offset: String(offset),
    index: query ? 'relevance' : 'downloads',
    facets: facetsFor(opts),
  });
  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.hits.map(toResult);
}

/** 300 самых скачиваемых проектов для этой сборки (запоминаем на время работы лаунчера). */
async function popular(opts) {
  const key = `${opts.kind}:${opts.gameVersion || ''}:${opts.loader || ''}`;
  if (!popularCache.has(key)) {
    const pages = await Promise.all([0, 100, 200].map((off) => rawSearch(opts, '', 100, off).catch(() => [])));
    popularCache.set(key, pages.flat());
  }
  return popularCache.get(key);
}

/**
 * @param {object} opts
 * @param {string} opts.query   что ищем
 * @param {string} opts.kind    mod | shader | resourcepack | datapack | modpack
 * @param {string} [opts.gameVersion]  например "26.3"
 * @param {string} [opts.loader]       fabric | forge | neoforge | quilt | vanilla
 */
export async function searchModrinth(opts) {
  const query = (opts.query || '').trim();
  if (!query) return rawSearch(opts, '');

  const variants = queryVariants(query).slice(0, 3);
  const [lists, top] = await Promise.all([
    Promise.all(variants.map((v) => rawSearch(opts, v).catch(() => []))),
    popular(opts).catch(() => []),
  ]);

  // Свои находки среди популярных — самые надёжные, ставим их первыми
  const local = top
    .map((p) => ({ p, score: matchScore(query, p.title, p.slug) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.downloads - a.p.downloads)
    .map((x) => x.p);

  const seen = new Set();
  const out = [];
  for (const r of [...local, ...lists.flat()]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  if (!out.length && lists.every((l) => !l.length) && !top.length) throw new Error('offline');
  return out.slice(0, 30);
}
