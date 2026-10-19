"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { type HeroTalent } from "@/domain/hero-build";

import {
  emptyInventory,
  updateInventory,
  projectInventory,
  type InventoryAction,
  type InventoryCatalog,
  type HeroInventory,
} from "@/domain/hero-inventory";

import {
  normalizeAbilityBuild,
  updateAbilityBuild,
  type HeroAbilityBuildState,
  type HeroAbilityBuildAction,
  type HeroAbilityRule,
} from "@/domain/hero-abilities";
import { heroAbilityRules } from "@/presentation/ability-levels";
import { projectHeroAbilityStats } from "@/presentation/hero-ability-stats";
import type { TooltipAbility } from "@/presentation/dota";
import { ResourceCache } from "@/lib/resource-cache";
import type { HeroStatusCatalog } from "@/domain/hero-status-catalog";
const statusCatalogs = new ResourceCache<HeroStatusCatalog>({
  entries: 2,
  bytes: 20 * 1024 * 1024,
});
const noAbilities: readonly TooltipAbility[] = [];

interface HeroBuildContextValue {
  build: HeroAbilityBuildState;
  talents: readonly HeroTalent[];
  dispatch: (action: HeroAbilityBuildAction) => void;
  abilityProjection: ReturnType<typeof projectHeroAbilityStats>;
  statStages: Array<{
    source: import("@/domain/hero-inventory").InventoryStatSource | null;
    modifiers: import("@/domain/hero-build").HeroStatModifier[];
  }>;
  inventory: HeroInventory;
  inventoryCatalog: InventoryCatalog | null;
  itemImageVersion: string | null;
  inventoryProjection: ReturnType<typeof projectInventory> | null;
  inventoryDispatch: (action: InventoryAction) => void;
  reset: () => void;
  resetVersion: number;
  abilityImageVersion: string | null;
  statusCatalogLoading: boolean;
  statusCatalogError: boolean;
  statusCatalogLoaded: boolean;
  loadStatusCatalog: () => Promise<void>;
}
const HeroBuildContext = createContext<HeroBuildContextValue | null>(null);

const HeroAbilityBuildContext = createContext<{
  build: HeroAbilityBuildState;
  rules: readonly HeroAbilityRule[];
  dispatch: (action: HeroAbilityBuildAction) => void;
  appliedStats: string[];
  selectedTalents: string[];
  talents: readonly HeroTalent[];
  upgrades: { scepter: boolean; shard: boolean };
  resetVersion: number;
} | null>(null);

/** The page keys this boundary by hero and Catalog; locale changes retain choices. */
export function HeroBuildProvider({
  talents,
  abilities = noAbilities,
  sourceCommit = null,
  children,
  inventoryCatalog: baseInventoryCatalog = null,
  catalogVersion = null,
  abilityImageVersion = null,
  itemImageVersion = null,
  attackType = "melee",
}: {
  talents: readonly HeroTalent[];
  abilities?: readonly TooltipAbility[];
  sourceCommit?: string | null;
  children: ReactNode;
  inventoryCatalog?: InventoryCatalog | null;
  catalogVersion?: string | null;
  abilityImageVersion?: string | null;
  itemImageVersion?: string | null;
  attackType?: string;
}) {
  const [statusCatalog, setStatusCatalog] = useState<HeroStatusCatalog | null>(
    null,
  );
  const [statusCatalogLoading, setStatusCatalogLoading] = useState(false);
  const [statusCatalogError, setStatusCatalogError] = useState(false);
  const loadStatusCatalog = useCallback(async () => {
    if (!catalogVersion || !sourceCommit) {
      setStatusCatalogError(true);
      return;
    }
    setStatusCatalogLoading(true);
    setStatusCatalogError(false);
    try {
      const result = await statusCatalogs.get(
        `${catalogVersion}:${sourceCommit}`,
        async () => {
          const response = await fetch(
            `/api/catalog/hero-statuses?dataset=${encodeURIComponent(catalogVersion)}`,
          );
          if (!response.ok) throw new Error("Status catalog unavailable");
          const data: HeroStatusCatalog = await response.json();
          if (
            data.dataset !== catalogVersion ||
            data.sourceCommit !== sourceCommit ||
            !Array.isArray(data.statuses)
          )
            throw new Error("Status catalog identity mismatch");
          return data;
        },
      );
      setStatusCatalog(result);
    } catch {
      setStatusCatalogError(true);
    } finally {
      setStatusCatalogLoading(false);
    }
  }, [catalogVersion, sourceCommit]);
  const inventoryCatalog = useMemo(
    () =>
      baseInventoryCatalog
        ? {
            ...baseInventoryCatalog,
            statuses: [
              ...baseInventoryCatalog.statuses,
              ...(statusCatalog?.statuses ?? []),
            ],
          }
        : null,
    [baseInventoryCatalog, statusCatalog],
  );
  const rules = useMemo(() => heroAbilityRules(abilities), [abilities]);
  const [state, setState] = useState<HeroAbilityBuildState>({
    level: 1,
    selectedTalents: [],
    abilityLevels: {},
  });
  const [inventory, setInventory] = useState(emptyInventory);
  const [resetVersion, setResetVersion] = useState(0);
  const build = useMemo(
    () => normalizeAbilityBuild(state, talents, rules),
    [state, talents, rules],
  );
  const inventoryProjection = useMemo(
    () =>
      inventoryCatalog
        ? projectInventory(inventory, inventoryCatalog, attackType)
        : null,
    [inventory, inventoryCatalog, attackType],
  );
  const dispatch = useCallback(
    (action: HeroAbilityBuildAction) =>
      setState((previous) =>
        updateAbilityBuild(previous, action, talents, rules),
      ),
    [talents, rules],
  );
  const inventoryDispatch = useCallback(
    (action: InventoryAction) => {
      if (inventoryCatalog)
        setInventory((previous) =>
          updateInventory(previous, action, inventoryCatalog),
        );
    },
    [inventoryCatalog],
  );
  const reset = useCallback(() => {
    setState({ level: 1, selectedTalents: [], abilityLevels: {} });
    setInventory(emptyInventory());
    setResetVersion((version) => version + 1);
  }, []);
  const scepter = inventoryProjection?.upgrades.scepter ?? false;
  const shard = inventoryProjection?.upgrades.shard ?? false;
  const abilityProjection = useMemo(
    () =>
      projectHeroAbilityStats(
        abilities,
        rules,
        build,
        { scepter, shard },
        sourceCommit,
      ),
    [abilities, rules, build, scepter, shard, sourceCommit],
  );
  const statStages = useMemo(() => {
    const upgrades = { scepter: false, shard: false };
    const itemModifiers: import("@/domain/hero-build").HeroStatModifier[] = [];
    const abilityModifiers = () =>
      projectHeroAbilityStats(abilities, rules, build, upgrades, sourceCommit)
        .modifiers;
    const stages: HeroBuildContextValue["statStages"] = [
      { source: null, modifiers: abilityModifiers() },
    ];
    let appliedAbilityModifiers = stages[0].modifiers;
    for (const source of inventoryProjection?.sources ?? []) {
      itemModifiers.push(...source.modifiers);
      if (source.upgrade && !upgrades[source.upgrade]) {
        upgrades[source.upgrade] = true;
        appliedAbilityModifiers = abilityModifiers();
      }
      stages.push({
        source,
        modifiers: [...itemModifiers, ...appliedAbilityModifiers],
      });
    }
    return stages;
  }, [abilities, rules, build, sourceCommit, inventoryProjection]);
  const value = useMemo(
    () => ({
      build,
      talents,
      dispatch,
      inventory,
      inventoryCatalog,
      abilityImageVersion,
      statusCatalogLoading,
      statusCatalogError,
      statusCatalogLoaded: statusCatalog !== null,
      loadStatusCatalog,
      itemImageVersion,
      inventoryProjection,
      abilityProjection,
      statStages,
      inventoryDispatch,
      reset,
      resetVersion,
    }),
    [
      build,
      talents,
      dispatch,
      inventory,
      inventoryCatalog,
      abilityImageVersion,
      statusCatalogLoading,
      statusCatalogError,
      statusCatalog,
      loadStatusCatalog,
      itemImageVersion,
      inventoryProjection,
      abilityProjection,
      statStages,
      inventoryDispatch,
      reset,
      resetVersion,
    ],
  );
  const abilityValue = useMemo(
    () => ({
      build,
      rules,
      dispatch,
      appliedStats: abilityProjection.applied,
      selectedTalents: build.selectedTalents,
      talents,
      upgrades: { scepter, shard },
      resetVersion,
    }),
    [
      build,
      rules,
      dispatch,
      abilityProjection.applied,
      talents,
      scepter,
      shard,
      resetVersion,
    ],
  );
  return (
    <HeroBuildContext.Provider value={value}>
      <HeroAbilityBuildContext.Provider value={abilityValue}>
        {children}
      </HeroAbilityBuildContext.Provider>
    </HeroBuildContext.Provider>
  );
}

export const useHeroBuild = () => useContext(HeroBuildContext);

export const useHeroAbilityBuild = () => useContext(HeroAbilityBuildContext);
