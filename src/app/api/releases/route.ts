import { getReleaseIndex } from "@/server/services/releases";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import {
  catalogJsonResponse,
  listProblemResponse,
} from "@/app/api/catalog/request";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(await db.verifyIdentity());
    return catalogJsonResponse(await getReleaseIndex(), identity);
  } catch (error) {
    return listProblemResponse(error, getDeclaredPublicEnvironment());
  }
}
