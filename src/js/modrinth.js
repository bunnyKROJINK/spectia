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

function facetsFor({ kind, gameVersion, loader, categories }) {
  const facets = [[`project_type:${kind}`]];
  // Каждая выбранная категория — отдельное условие «И»: декор + еда = моды, где есть и то и другое
  for (const c of categories || []) facets.push([`categories:${c}`]);
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
    follows: h.follows || 0,
    created: h.date_created || '',
    updated: h.date_modified || '',
    categories: h.display_categories || h.categories || [],
    url: `https://modrinth.com/${h.project_type}/${h.slug}`,
  };
}

async function rawSearch(opts, query, limit = 20, offset = 0) {
  const params = new URLSearchParams({
    query: query || '',
    limit: String(limit),
    offset: String(offset),
    index: opts.index || (query ? 'relevance' : 'downloads'),
    facets: facetsFor(opts),
  });
  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.hits.map(toResult);
}

/** 300 самых скачиваемых проектов для этой сборки (запоминаем на время работы лаунчера). */
async function popular(opts) {
  const key = `${opts.kind}:${opts.gameVersion || ''}:${opts.loader || ''}:${(opts.categories || []).join(',')}`;
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

// ---------- Категории (как на сайте Modrinth) ----------

const MOD_CATS = ['adventure', 'decoration', 'food', 'magic', 'technology', 'worldgen', 'mobs', 'equipment', 'storage', 'transportation', 'optimization', 'utility', 'game-mechanics', 'library', 'social'];
export const CATEGORIES = {
  mod: MOD_CATS,
  datapack: MOD_CATS,
  modpack: ['adventure', 'challenging', 'combat', 'kitchen-sink', 'lightweight', 'magic', 'multiplayer', 'optimization', 'quests', 'technology'],
  resourcepack: ['16x', '32x', 'cartoon', 'realistic', 'simplistic', 'themed', 'tweaks', 'vanilla-like', 'audio', 'fonts', 'gui'],
  shader: ['cartoon', 'cursed', 'fantasy', 'realistic', 'semi-realistic', 'vanilla-like'],
};

// ---------- Подробности о проекте ----------

const projectCache = new Map();

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Полная карточка проекта: описание, картинки, ссылки, подходящие версии. */
export async function projectDetails(id, { gameVersion, loader, kind } = {}) {
  const key = `${id}:${gameVersion}:${loader}`;
  if (projectCache.has(key)) return projectCache.get(key);
  const params = new URLSearchParams();
  if (gameVersion && kind !== 'modpack') params.set('game_versions', JSON.stringify([gameVersion]));
  if (kind === 'mod' && loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]));
  const [project, versions, members] = await Promise.all([
    getJson(`${BASE}/project/${id}`),
    getJson(`${BASE}/project/${id}/version?${params}`).catch(() => []),
    getJson(`${BASE}/project/${id}/members`).catch(() => []),
  ]);
  // Зависимости последней подходящей версии: только названия, без лишних запросов
  const deps = (versions[0]?.dependencies || []).filter((d) => d.project_id && (d.dependency_type === 'required' || d.dependency_type === 'optional'));
  let depProjects = [];
  if (deps.length) {
    depProjects = await getJson(`${BASE}/projects?ids=${encodeURIComponent(JSON.stringify(deps.map((d) => d.project_id)))}`).catch(() => []);
  }
  const out = {
    id: project.id,
    slug: project.slug,
    title: project.title,
    description: project.description,
    body: project.body || '',
    icon: project.icon_url || '',
    downloads: project.downloads,
    followers: project.followers,
    updated: project.updated,
    published: project.published,
    license: project.license?.name || project.license?.id || '',
    categories: project.categories || [],
    gallery: (project.gallery || []).slice(0, 8).map((g) => ({ url: g.url, title: g.title || '' })),
    links: {
      source: project.source_url, issues: project.issues_url, wiki: project.wiki_url, discord: project.discord_url,
      page: `https://modrinth.com/${project.project_type}/${project.slug}`,
    },
    authors: members.map((m) => m.user?.username).filter(Boolean),
    versions: versions.slice(0, 8).map((v) => ({ name: v.version_number, type: v.version_type, date: v.date_published, loaders: v.loaders, games: v.game_versions })),
    deps: deps.map((d) => ({ type: d.dependency_type, title: depProjects.find((p) => p.id === d.project_id)?.title || d.project_id })),
  };
  projectCache.set(key, out);
  return out;
}

/**
 * Подборки для новостей:
 *  • spotlight — «Мод недели»: самый скачиваемый из появившихся за последний месяц;
 *  • rising — другие популярные новинки;
 *  • updated — что недавно обновилось среди популярных.
 */
export async function trending(kind = 'mod') {
  const pick = (index, limit) => rawSearch({ kind, index }, '', limit).catch(() => []);
  const [newest, updated] = await Promise.all([pick('newest', 100), pick('updated', 40)]);
  const monthAgo = Date.now() - 30 * 86400e3;
  const rising = newest.filter((p) => Date.parse(p.created) > monthAgo).sort((a, b) => b.downloads - a.downloads);
  const popularUpdated = updated.filter((p) => p.downloads > 50000).slice(0, 8);
  return { spotlight: rising[0] || null, rising: rising.slice(1, 9), updated: popularUpdated };
}
