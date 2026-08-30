import { createHash } from "node:crypto";

import type { CatalogEntityKind } from "@/domain/catalog-stream";
import { isDatasetVersionId } from "@/domain/dataset-version";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 4_096;
const MAX_SORT_PART_BYTES = 1_024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type CatalogLocale = "zh-CN" | "en";

interface CursorIdentity {
  version: typeof CURSOR_VERSION;
  entityKind: CatalogEntityKind;
  catalogDatasetVersionId: string;
  assetDatasetVersionId: string;
  locale: CatalogLocale;
  filterIdentity: string;
}

export interface AbilityListCursor extends CursorIdentity {
  entityKind: "abilities";
  sort: [localizedSortName: string, internalName: string];
}

export interface HeroListCursor extends CursorIdentity {
  entityKind: "heroes";
  sort: [attributeRank: number, heroId: number];
}

export type ListCursor = AbilityListCursor | HeroListCursor;
export type CatalogCursor = ListCursor;

export interface ListCursorExpectation {
  entityKind: CatalogEntityKind;
  locale: CatalogLocale;
  filterIdentity: string;
  catalogDatasetVersionId?: string;
  assetDatasetVersionId?: string;
}

export interface ListSliceRequest {
  after?: string;
  before?: string;
  catalogDatasetVersionId?: string;
  assetDatasetVersionId?: string;
}

export class ListRequestError extends Error {
  readonly code = "invalid_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "ListRequestError";
  }
}

export class ListCursorError extends Error {
  constructor(
    readonly code: "invalid_cursor" | "stream_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ListCursorError";
  }
}

export class ListDatasetUnavailableError extends Error {
  readonly code = "dataset_unavailable" as const;

  constructor(message = "游标固定的数据版本已不可用。") {
    super(message);
    this.name = "ListDatasetUnavailableError";
  }
}

export function createListFilterIdentity(canonicalQuery: string): string {
  return createHash("sha256").update(canonicalQuery, "utf8").digest("hex");
}

export const createCatalogFilterIdentity = createListFilterIdentity;

export function isListDatasetVersionId(value: string): boolean {
  return isDatasetVersionId(value);
}

export function encodeListCursor(cursor: ListCursor): string {
  assertCursorShape(cursor);
  const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  if (encoded.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  return encoded;
}

export const encodeCatalogCursor = encodeListCursor;

export function decodeListCursor(encoded: string): ListCursor {
  if (
    encoded.length === 0 ||
    encoded.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(encoded)
  ) {
    throw invalidCursor();
  }

  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw invalidCursor();
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidCursor();
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    throw invalidCursor();
  }
  assertCursorShape(value);
  return value;
}

export const decodeCatalogCursor = decodeListCursor;

export function assertListCursorMatches(
  cursor: ListCursor,
  expected: ListCursorExpectation,
): void {
  if (
    cursor.entityKind !== expected.entityKind ||
    cursor.locale !== expected.locale ||
    cursor.filterIdentity !== expected.filterIdentity ||
    (expected.catalogDatasetVersionId !== undefined &&
      cursor.catalogDatasetVersionId !== expected.catalogDatasetVersionId) ||
    (expected.assetDatasetVersionId !== undefined &&
      cursor.assetDatasetVersionId !== expected.assetDatasetVersionId)
  ) {
    throw new ListCursorError(
      "stream_mismatch",
      "游标与当前列表的数据版本、语言或筛选条件不匹配。",
    );
  }
}

export const assertCatalogCursorMatches = assertListCursorMatches;

function assertCursorShape(value: unknown): asserts value is ListCursor {
  if (!isRecord(value)) throw invalidCursor();
  if (
    !hasExactlyKeys(value, [
      "version",
      "entityKind",
      "catalogDatasetVersionId",
      "assetDatasetVersionId",
      "locale",
      "filterIdentity",
      "sort",
    ])
  ) {
    throw invalidCursor();
  }
  if (
    value.version !== CURSOR_VERSION ||
    (value.entityKind !== "heroes" && value.entityKind !== "abilities") ||
    typeof value.catalogDatasetVersionId !== "string" ||
    !isDatasetVersionId(value.catalogDatasetVersionId) ||
    typeof value.assetDatasetVersionId !== "string" ||
    !isDatasetVersionId(value.assetDatasetVersionId) ||
    (value.locale !== "zh-CN" && value.locale !== "en") ||
    typeof value.filterIdentity !== "string" ||
    !SHA256_PATTERN.test(value.filterIdentity) ||
    !Array.isArray(value.sort) ||
    value.sort.length !== 2
  ) {
    throw invalidCursor();
  }

  if (value.entityKind === "abilities") {
    if (
      !value.sort.every(
        (part) =>
          typeof part === "string" &&
          part.length > 0 &&
          !part.includes("\0") &&
          Buffer.byteLength(part, "utf8") <= MAX_SORT_PART_BYTES,
      )
    ) {
      throw invalidCursor();
    }
    return;
  }

  const [attributeRank, heroId] = value.sort;
  if (
    !Number.isInteger(attributeRank) ||
    attributeRank < 0 ||
    attributeRank > 3 ||
    !Number.isSafeInteger(heroId) ||
    heroId <= 0 ||
    heroId > 2_147_483_647
  ) {
    throw invalidCursor();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function invalidCursor(): ListCursorError {
  return new ListCursorError("invalid_cursor", "列表游标格式无效。");
}
