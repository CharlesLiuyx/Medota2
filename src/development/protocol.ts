import type { SampleResult } from "./sample";
import type { PreviewDataSource } from "./preview";

export interface WorkbenchStatus {
  schemaVersion: 1;
  instance: string;
  phase: "starting" | "ready" | "stopped" | "error";
  revision: number;
  sample: "queued" | "running" | "passed" | "error" | "cancelled";
  changedFiles: string[];
  message: string;
  updatedAt: string;
  result?: SampleResult;
  resultRevision?: number;
  savedToResultMs?: number;
  pendingSetup: string[];
  dataSource?: PreviewDataSource;
}
