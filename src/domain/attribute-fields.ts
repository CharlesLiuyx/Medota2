/** Every numeric root field is accounted for. Unknown fields stay owner-scoped. */
export const NON_ATTRIBUTE_FIELDS: Record<string, string> = {};
for (const [reason, names] of Object.entries({
  "identity-or-classification":
    "HeroID HeroOrderID EventID ScepterUpgradeID ShardUpgradeID AssociatedLevelItemDef AssociatedConsumable TokenTier ItemRecipe ItemIsNeutralActiveDrop ItemIsNeutralPassiveDrop ItemIsNeutralDrop IsAncient IsNeutralUnitType ConsideredHero IsSummoned IsOther IsBoss IsRoshan Complexity Enabled CMEnabled new_player_enable HeroUnlockOrder HeroPool1 HeroPool2 NewHero ARDMDisabled RandomEnabled ReleaseTimestamp Innate HasScepterUpgrade HasShardUpgrade IsGrantedByShard IsGrantedByScepter IsShardUpgrade HasSubAbility",
  "presentation-or-editor":
    "SoundSet ModelScale Modelscale VersusScale LoadoutScale SpectatorLoadoutScale TransformedLoadoutScale AlternateLoadoutScale MaxModelScaleMultiplier GibTintColor HeroGlowColor HealthBarOffset RingRadius MinimapIconSize wearable skin AbilityLayout DrawParticlesWhileHidden CustomHealthbarStyle spawn_wearable_item_defs item_def0 item_def1 item_def2 item_def3 style_index0 style_index1 style_index2 style_index3 DisableDamageDisplay OnCastbar OnLearnbar FightRecapLevel AnimationIgnoresModelScale UnlockMinEffectIndex UnlockMaxEffectIndex ItemHideCharges ItemDisplayCharges ShowGiveIndicatorOnTargetCast DisplayOverheadAlertOnReceived ItemAlertable ActiveDescriptionLine EnableChargeDisplayOverride ShowCooldownInTooltips DisplayAdditionalHeroes ShowDroppedItemTooltip IdleSoundLoop Press Legs PickSound BanSound ShowcasePlayIdleExpression",
  "behavior-or-availability":
    "SelectOnSpawn CanBeDominated IgnoreAddSummonedToSelection AutoAttacksByDefault HasAggressiveStance NeutralIgnore HasInventory WakesNeutrals PathfindingSearchDepthScale ImmuneToOmnislash UseNeutralCreepBehavior RunAIWhenControllableByPlayer UntargetableByExorcismSpirits SuggestLategame SecretShop IsObsolete SuggestPregame ItemStackable ItemPermanent IsTempestDoubleClonable SpeciallyBannedFromNeutralSlot ItemPurchasable SuggestEarlygame ItemSellable ItemInitiallySellable ItemSupport ItemKillable ItemContributesToNetWorthWhenDropped AllowedInBackpack ShouldNotSuggestMainGame ItemAllowCombineFromGround ItemRequiresCharges ItemRecipeConsumesCharges ItemDroppable ItemCanBeConsumed SpeciallyAllowedInNeutralSlot CooldownPausedOutOfInventory ItemCanBeUsedWithoutInventory PlayerSpecificCooldown ItemCastOnPickup AutoPickup ItemCombinable ItemDisassemblable ItemDeclaresPurchase IsCastableWhileHidden IsBreakable RestrictValuesToMaxLevel NoCombine BotImplemented BotForceSelection",
}))
  for (const name of names.split(" "))
    NON_ATTRIBUTE_FIELDS[name.toLowerCase()] = reason;

export interface SourceFields {
  entries: Array<{ key: string; value: string | SourceFields; line?: number }>;
}
const numeric =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+))*$/u;
export function auditNumericFields(source: unknown) {
  const entries = (source as SourceFields | undefined)?.entries;
  return (Array.isArray(entries) ? entries : []).flatMap((entry) =>
    typeof entry.value === "string" && numeric.test(entry.value.trim())
      ? [
          {
            key: entry.key,
            value: entry.value,
            line: entry.line,
            excluded: NON_ATTRIBUTE_FIELDS[entry.key.toLowerCase()] ?? null,
          },
        ]
      : [],
  );
}
export function numericAttributeFields(source: unknown) {
  return auditNumericFields(source).filter((entry) => !entry.excluded);
}
/** Inheritance follows the unit adapter, preserving the line that supplied a value. */
export function resolvedUnitAttributeFields(root: SourceFields) {
  const definitions = new Map(
    root.entries
      .filter((e) => typeof e.value === "object")
      .map((e) => [e.key, e.value as SourceFields]),
  );
  const result = new Map<string, SourceFields>();
  function resolve(id: string, chain: string[] = []): SourceFields {
    if (result.has(id)) return result.get(id)!;
    if (chain.includes(id))
      throw new Error(`Cyclic unit attribute inheritance: ${id}`);
    const own = definitions.get(id);
    if (!own) throw new Error(`Missing unit attribute source: ${id}`);
    const parent = own.entries.find(
      (e) => e.key === "include_keys_from",
    )?.value;
    const base =
      typeof parent === "string"
        ? resolve(parent, [...chain, id])
        : id === "npc_dota_units_base"
          ? { entries: [] }
          : resolve("npc_dota_units_base", [...chain, id]);
    const fields = new Map(base.entries.map((e) => [e.key, e]));
    own.entries.forEach((e) => fields.set(e.key, e));
    const merged = { entries: [...fields.values()] };
    result.set(id, merged);
    return merged;
  }
  for (const id of definitions.keys()) resolve(id);
  return result;
}
