import { z } from "zod";
import { getCatalogReplica } from "@/server/services/catalog-replica";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import {
  isListDatasetVersionId,
  ListRequestError,
} from "@/server/services/catalog-cursor";
import { catalogJsonResponse, listProblemResponse } from "../request";

export const dynamic = "force-dynamic";
const input = z
  .object({
    entity: z.enum(["heroes", "abilities"]),
    locale: z.enum(["en", "zh-CN"]),
    datasetVersionId: z.string().refine(isListDatasetVersionId),
    assetDatasetVersionId: z.string().refine(isListDatasetVersionId),
    known: z
      .array(z.string().regex(/^[a-f0-9]{64}$/u))
      .max(16)
      .default([]),
  })
  .strict();
/** Read-only synchronization: response includes only content blocks the browser lacks. */
export async function POST(request: Request): Promise<Response> {
  const declared = getDeclaredPublicEnvironment();
  try {
    const text = await request.text();
    if (text.length > 4096) throw new ListRequestError("同步请求过大。");
    const parsed = input.safeParse(JSON.parse(text));
    if (!parsed.success) throw new ListRequestError("无效的资料同步请求。");
    const { known, ...identity } = parsed.data;
    const db = await getWebDatabase();
    const verified = toPublicEnvironmentIdentity(await db.verifyIdentity());
    const replica = await getCatalogReplica(identity);
    const present = new Set(known);
    return catalogJsonResponse(
      {
        manifest: replica.manifest,
        blocks: Object.fromEntries(
          Object.entries(replica.blocks).filter(([hash]) => !present.has(hash)),
        ),
      },
      verified,
    );
  } catch (error) {
    return listProblemResponse(
      error instanceof SyntaxError
        ? new ListRequestError("同步请求不是有效JSON。")
        : error,
      declared,
    );
  }
}
