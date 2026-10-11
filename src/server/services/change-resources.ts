import "server-only";
import { ResourceCache } from "@/lib/resource-cache";
import { canonicalJsonSha256 } from "@/lib/hash";
import {
  changeTableGroups,
  type ChangeTableGroup,
} from "@/presentation/changes-table";
import type {
  EntityVersionDiff,
  EntityVersionChange,
} from "@/domain/entity-version-diff";
import type { Locale } from "@/i18n/locale";
import type { getReleaseChangesView } from "./release-changes";
import { entityDiffResourceId } from "./entity-version-diff";

interface ChangeResources {
  from: string;
  to: string;
  locale: Locale;
  diffId: string;
  groups: ChangeTableGroup[];
  technical: EntityVersionChange[];
  unresolved: EntityVersionDiff["unresolved"];
}
const resources = new ResourceCache<ChangeResources>({
  entries: 6,
  bytes: 48 * 1024 * 1024,
});
export function prepareChangeResources(
  diff: EntityVersionDiff,
  view: Awaited<ReturnType<typeof getReleaseChangesView>>,
  locale: Locale,
) {
  const groups = changeTableGroups(view.groups, locale);
  const bundle: ChangeResources = {
    from: diff.fromVersion,
    to: diff.toVersion,
    locale,
    diffId: entityDiffResourceId(diff),
    groups,
    technical: view.technical,
    unresolved: diff.unresolved,
  };
  const resourceId = canonicalJsonSha256([
    "change-evidence/1",
    bundle.diffId,
    locale,
    groups.map((group) => [
      group.key,
      group.rows.map((row) => [row.key, row.evidence]),
    ]),
    bundle.technical,
    bundle.unresolved,
  ]);
  resources.set(resourceId, bundle);
  const base = `/api/releases/change-resource?${new URLSearchParams({ from: bundle.from, to: bundle.to, lang: locale, resource: resourceId })}`;
  return {
    resourceId,
    bundle,
    auditUrl: `${base}&audit=1`,
    groups: groups.map((group) => ({
      ...group,
      rows: group.rows.map((row) => ({
        ...row,
        evidence: [],
        ...(row.evidence.length
          ? {
              evidenceRef: {
                url: `${base}&${new URLSearchParams({ group: group.key, row: row.key })}`,
                count: row.evidence.length,
                kinds: [
                  ...new Set(row.evidence.map((entry) => entry.entityType)),
                ],
              },
            }
          : {}),
      })),
    })),
  };
}
export function readChangeResource(
  resourceId: string,
  diff: EntityVersionDiff,
  locale: Locale,
) {
  const bundle = resources.peek(resourceId);
  return bundle?.from === diff.fromVersion &&
    bundle.to === diff.toVersion &&
    bundle.locale === locale &&
    bundle.diffId === entityDiffResourceId(diff)
    ? bundle
    : undefined;
}
