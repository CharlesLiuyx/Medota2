import "server-only";
import { createSearchIndex, type SearchEntry } from "@/domain/search";
import { ABILITY_ALIASES, HERO_ALIASES } from "@/domain/search/aliases";
import { getWebDatabase } from "@/server/db/client";
import { getGameLocalization } from "./game-localization";

type SearchIndex = ReturnType<typeof createSearchIndex>;
// Bounded across dataset switches; concurrent first queries share the build.
const indexes = new Map<string, Promise<SearchIndex>>();
function cached(key: string, build: () => Promise<SearchIndex>) {
  let pending = indexes.get(key);
  if (!pending) {
    pending = build();
    indexes.set(key, pending);
    if (indexes.size > 8) indexes.delete(indexes.keys().next().value!);
    void pending.catch(() => {
      if (indexes.get(key) === pending) indexes.delete(key);
    });
  }
  return pending;
}

interface HeroNames {
  id: string;
  slug: string;
  names: string[];
}
async function heroNames(dataset: string): Promise<HeroNames[]> {
  const db = await getWebDatabase();
  const result = await db.query<HeroNames>(
    `SELECT h.hero_id::text AS id, h.slug,
       array_agg(DISTINCT l.display_name) || array_agg(DISTINCT l.english_name_variant) AS names
     FROM heroes h LEFT JOIN hero_localizations l ON l.dataset_version_id=h.dataset_version_id AND l.hero_id=h.hero_id
     WHERE h.dataset_version_id=$1 GROUP BY h.hero_id,h.slug`,
    [dataset],
  );
  return result.rows;
}

export async function getHeroSearchIndex(dataset: string) {
  const index = await cached(`heroes:${dataset}`, async () => {
    const heroes = await heroNames(dataset);
    return createSearchIndex(
      heroes.map((hero) => ({
        id: hero.id,
        names: [
          hero.id,
          hero.slug,
          `npc_dota_hero_${hero.slug}`,
          ...hero.names,
        ],
        aliases: HERO_ALIASES[hero.slug],
      })),
    );
  });
  return index;
}

export async function getAbilitySearchIndex(dataset: string) {
  const index = await cached(`abilities:${dataset}`, async () => {
    const db = await getWebDatabase();
    const [result, heroes, zh, en] = await Promise.all([
      db.query<{ id: string; names: string[]; owners: string[] }>(
        `SELECT a.internal_name AS id,
           ARRAY(SELECT l.display_name FROM ability_localizations l WHERE l.dataset_version_id=a.dataset_version_id AND l.ability_internal_name=a.internal_name) AS names,
           ARRAY(SELECT DISTINCT h.slug FROM hero_ability_bindings b JOIN heroes h ON h.dataset_version_id=b.dataset_version_id AND h.hero_id=b.hero_id WHERE b.dataset_version_id=a.dataset_version_id AND b.ability_internal_name=a.internal_name) AS owners
         FROM abilities a WHERE a.dataset_version_id=$1`,
        [dataset],
      ),
      heroNames(dataset),
      getGameLocalization(dataset, null, "zh-CN"),
      getGameLocalization(dataset, null, "en"),
    ]);
    const ownerNames = new Map(
      heroes.map((hero) => [
        hero.slug,
        [hero.slug, ...hero.names, ...(HERO_ALIASES[hero.slug] ?? [])],
      ]),
    );
    const entries: SearchEntry[] = result.rows.map((row) => ({
      id: row.id,
      names: [
        row.id,
        ...row.names,
        zh[`dota_tooltip_ability_${row.id}`],
        en[`dota_tooltip_ability_${row.id}`],
      ],
      aliases: ABILITY_ALIASES[row.id],
      context: row.owners.flatMap((owner) => ownerNames.get(owner) ?? []),
    }));
    return createSearchIndex(entries);
  });
  return index;
}

export async function searchCatalogHeroes(dataset: string, query: string) {
  return (await getHeroSearchIndex(dataset)).search(query).map(Number);
}
export async function searchCatalogAbilities(dataset: string, query: string) {
  return (await getAbilitySearchIndex(dataset)).search(query);
}
