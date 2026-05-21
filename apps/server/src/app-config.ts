import * as path from "path";
import * as fs from "fs";

export interface AppConfig {
  sessionTtlMinutes: number;
}

const DEFAULT: AppConfig = { sessionTtlMinutes: 480 };

function appConfigPath(dataDir: string): string {
  return path.join(dataDir, "app-config.json");
}

export function loadAppConfig(dataDir: string): AppConfig {
  try {
    const raw = fs.readFileSync(appConfigPath(dataDir), "utf8");
    const cfg = JSON.parse(raw) as Partial<AppConfig>;
    return { sessionTtlMinutes: cfg.sessionTtlMinutes ?? DEFAULT.sessionTtlMinutes };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveAppConfig(dataDir: string, cfg: AppConfig): void {
  fs.writeFileSync(appConfigPath(dataDir), JSON.stringify(cfg, null, 2));
}
