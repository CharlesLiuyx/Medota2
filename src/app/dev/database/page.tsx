import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  developmentEnabled,
  developmentRequestAllowed,
} from "@/development/request";
import { DatabaseInspector } from "@/components/database-inspector";
export const dynamic = "force-dynamic";
export default async function DatabasePage() {
  if (!developmentEnabled() || !developmentRequestAllowed(await headers()))
    notFound();
  return <DatabaseInspector />;
}
