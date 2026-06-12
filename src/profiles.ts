import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Multi-profile bridge configuration (phase 1: unified project + per-profile daemons).
// bridges.json lives outside the skill repo so dependency updates never touch it.
// Secrets stay in each profile's config.env (chmod 600); this parser never reads them.

export interface BridgeProfile {
  id: string;
  runtime: "claude" | "codex";
  home: string;
  launchdLabel: string;
  channels: string[];
}

export interface BridgesConfig {
  bridges: BridgeProfile[];
}

export const BRIDGES_CONFIG_PATH =
  process.env.CTI_BRIDGES_CONFIG ||
  path.join(os.homedir(), ".claude-to-im", "bridges.json");

const VALID_RUNTIMES = new Set(["claude", "codex"]);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const LABEL_RE = /^[A-Za-z0-9.-]+$/;

export function parseBridgesConfig(raw: string, source = BRIDGES_CONFIG_PATH): BridgesConfig {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`bridges config is not valid JSON (${source}): ${(e as Error).message}`);
  }
  if (typeof data !== "object" || data === null || !Array.isArray((data as BridgesConfig).bridges)) {
    throw new Error(`bridges config must be an object with a "bridges" array (${source})`);
  }
  const bridges = (data as BridgesConfig).bridges;
  if (bridges.length === 0) {
    throw new Error(`bridges config has an empty "bridges" array (${source})`);
  }

  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const seenHomes = new Set<string>();

  for (const [i, b] of bridges.entries()) {
    const where = `bridges[${i}]`;
    if (typeof b.id !== "string" || !ID_RE.test(b.id)) {
      throw new Error(`${where}.id must match ${ID_RE} (got ${JSON.stringify(b.id)})`);
    }
    if (seenIds.has(b.id)) throw new Error(`duplicate profile id "${b.id}"`);
    seenIds.add(b.id);

    if (typeof b.runtime !== "string" || !VALID_RUNTIMES.has(b.runtime)) {
      throw new Error(`${where}.runtime must be one of ${[...VALID_RUNTIMES].join("/")} (got ${JSON.stringify(b.runtime)})`);
    }

    if (typeof b.home !== "string" || !path.isAbsolute(b.home)) {
      throw new Error(`${where}.home must be an absolute path (got ${JSON.stringify(b.home)})`);
    }
    const normHome = path.normalize(b.home);
    if (seenHomes.has(normHome)) throw new Error(`duplicate profile home "${normHome}" — two daemons sharing one home will corrupt state`);
    seenHomes.add(normHome);

    if (typeof b.launchdLabel !== "string" || !LABEL_RE.test(b.launchdLabel)) {
      throw new Error(`${where}.launchdLabel must match ${LABEL_RE} (got ${JSON.stringify(b.launchdLabel)})`);
    }
    if (seenLabels.has(b.launchdLabel)) throw new Error(`duplicate launchdLabel "${b.launchdLabel}"`);
    seenLabels.add(b.launchdLabel);

    if (!Array.isArray(b.channels) || b.channels.length === 0 || !b.channels.every((c) => typeof c === "string")) {
      throw new Error(`${where}.channels must be a non-empty string array`);
    }
  }
  return { bridges };
}

export function loadBridgesConfig(configPath = BRIDGES_CONFIG_PATH): BridgesConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `bridges config not found: ${configPath}\n` +
        `Create it with a "bridges" array (see SKILL.md "Multi-profile"), or set CTI_BRIDGES_CONFIG.`,
    );
  }
  return parseBridgesConfig(fs.readFileSync(configPath, "utf8"), configPath);
}

export function getProfile(config: BridgesConfig, id: string): BridgeProfile {
  const p = config.bridges.find((b) => b.id === id);
  if (!p) {
    const known = config.bridges.map((b) => b.id).join(", ");
    throw new Error(`unknown profile "${id}" (known: ${known})`);
  }
  return p;
}
