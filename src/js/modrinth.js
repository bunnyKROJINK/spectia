// Поиск на Modrinth. Их API открытый и не требует ключа.
// Документация: https://docs.modrinth.com/api/

const BASE = 'https://api.modrinth.com/v2';

/**
 * @param {object} opts
 * @param {string} opts.query   что ищем
 * @param {string} opts.kind    mod | shader | resourcepack | datapack | modpack
 * @param {string} [opts.gameVersion]  например "26.3"
 * @param {string} [opts.loader]       fabric | forge | neoforge | quilt | vanilla
 */
export async function searchModrinth({ query, kind, gameVersion, loader }) {
  const facets = [[`project_type:${kind}`]];
  if (gameVersion && kind !== 'modpack') facets.push([`versions:${gameVersion}`]);
  // Загрузчик важен только для модов: шейдерам и текстурпакам он не нужен.
  if (kind === 'mod' && loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);

  const params = new URLSearchParams({
    query: query || '',
    limit: '20',
    index: query ? 'relevance' : 'downloads',
    facets: JSON.stringify(facets),
  });

  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.hits.map((h) => ({
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    icon: h.icon_url || '',
    url: `https://modrinth.com/${h.project_type}/${h.slug}`,
  }));
}
