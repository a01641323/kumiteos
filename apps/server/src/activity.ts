import * as path from "path";
import { appendLine, readLines } from "./storage";

export type ActivityAction =
  // licensing events
  | "ACTIVATION_SUCCESS"
  | "ACTIVATION_FAILURE"
  | "RENEWAL_SUCCESS"
  | "RENEWAL_FAILURE"
  | "RENEWAL_REJECTED_REVOKED"
  | "MACHINE_MISMATCH"
  | "RATE_LIMITED"
  | "LICENSE_REVOKE"
  | "LICENSE_TRANSFER"
  | "LICENSE_EXTEND"
  | "LICENSE_CODE_CREATED"
  // app events
  | "data_update"
  | "logo_upload"
  | "logo_remove"
  | "session_revoke"
  | "generate_launch"
  | "prepare_download"
  | "access_extend";

export interface ActivityEntry {
  ts: number;
  event: ActivityAction;
  userId: string | null;
  ip: string | null;
  machineFingerprint?: string | null;
  jti?: string | null;
  result: "success" | "fail";
  reason?: string;
  message?: string;
}

function file(dataDir: string): string {
  return path.join(dataDir, "activity.log");
}

export function logActivity(dataDir: string, entry: ActivityEntry): void {
  appendLine(file(dataDir), JSON.stringify(entry));
}

export function readActivity(dataDir: string, max = 500): ActivityEntry[] {
  const lines = readLines(file(dataDir), max);
  const out: ActivityEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return out.reverse();
}
