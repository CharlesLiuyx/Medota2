import type { InfiniteListProblem } from "@/domain/infinite-list";
import type { SearchParams } from "@/server/services/hero-filters";
import {
  isListDatasetVersionId,
  ListCursorError,
  ListDatasetUnavailableError,
  ListRequestError,
  type ListSliceRequest,
} from "@/server/services/catalog-cursor";

const TRANSPORT_KEYS = new Set([
  "after",
  "before",
  "datasetVersionId",
  "assetDatasetVersionId",
]);

export function parseListRouteRequest(url: URL): {
  params: SearchParams;
  sliceRequest: ListSliceRequest;
} {
  const after = singleTransportValue(url.searchParams, "after");
  const before = singleTransportValue(url.searchParams, "before");
  if (after !== undefined && before !== undefined) {
    throw new ListRequestError("after 与 before 不能同时提供。");
  }
  const datasetVersionId = singleTransportValue(
    url.searchParams,
    "datasetVersionId",
  );
  const assetDatasetVersionId = singleTransportValue(
    url.searchParams,
    "assetDatasetVersionId",
  );
  if (
    (datasetVersionId === undefined) !==
    (assetDatasetVersionId === undefined)
  ) {
    throw new ListRequestError(
      "datasetVersionId 与 assetDatasetVersionId 必须成对提供。",
    );
  }
  if (
    (datasetVersionId !== undefined &&
      !isListDatasetVersionId(datasetVersionId)) ||
    (assetDatasetVersionId !== undefined &&
      !isListDatasetVersionId(assetDatasetVersionId))
  ) {
    throw new ListRequestError("dataset version 格式无效。");
  }

  const params: SearchParams = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (TRANSPORT_KEYS.has(key)) continue;
    const values = url.searchParams.getAll(key);
    params[key] = values.length === 1 ? values[0] : values;
  }
  return {
    params,
    sliceRequest: {
      ...(after !== undefined ? { after } : {}),
      ...(before !== undefined ? { before } : {}),
      ...(datasetVersionId !== undefined
        ? { catalogDatasetVersionId: datasetVersionId }
        : {}),
      ...(assetDatasetVersionId !== undefined ? { assetDatasetVersionId } : {}),
    },
  };
}

export function listProblemResponse(error: unknown): Response {
  let status = 500;
  let problem: InfiniteListProblem = {
    code: "query_failed",
    message: "列表查询失败，请稍后重试。",
  };
  if (error instanceof ListRequestError) {
    status = 400;
    problem = { code: error.code, message: error.message };
  } else if (error instanceof ListCursorError) {
    status = error.code === "invalid_cursor" ? 400 : 409;
    problem = { code: error.code, message: error.message };
  } else if (error instanceof ListDatasetUnavailableError) {
    status = 410;
    problem = { code: error.code, message: error.message };
  }
  return Response.json(problem, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function singleTransportValue(
  params: URLSearchParams,
  key: string,
): string | undefined {
  const values = params.getAll(key);
  if (values.length > 1) {
    throw new ListRequestError(`${key} 只允许一个值。`);
  }
  if (values.length === 0) return undefined;
  if (values[0].length === 0) {
    throw new ListRequestError(`${key} 不能为空。`);
  }
  return values[0];
}
