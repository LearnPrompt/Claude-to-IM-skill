#!/usr/bin/env bash
set -euo pipefail

# Unified multi-profile supervisor wrapper (phase 1 MVP).
# Reads bridges.json, sets CTI_HOME / CTI_LAUNCHD_LABEL per profile, and
# delegates to the existing daemon.sh / doctor.sh. No secrets are read or printed.
#
# Usage:
#   bridges.sh start|stop|status|logs|doctor all
#   bridges.sh start|stop|status|logs|doctor <profile-id>
#   bridges.sh list

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CTI_BRIDGES_CONFIG:-$HOME/.claude-to-im/bridges.json}"

usage() {
  sed -n '5,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 1 ] || usage
CMD="$1"
TARGET="${2:-all}"

case "$CMD" in
  start|stop|status|logs|doctor|list) ;;
  *) usage ;;
esac

if [ ! -f "$CONFIG" ]; then
  echo "bridges config not found: $CONFIG" >&2
  echo "Create it first (see SKILL.md 'Multi-profile') or set CTI_BRIDGES_CONFIG." >&2
  exit 1
fi

# Parse + validate via node; emit tab-separated "id runtime home label".
# Validation rules mirror src/profiles.ts (single source of truth is the TS
# module; this inline check covers the same hard failures for shell callers).
profiles_tsv() {
  node -e '
    const fs = require("fs"), path = require("path");
    const file = process.argv[1];
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { console.error("invalid JSON in " + file + ": " + e.message); process.exit(1); }
    if (!cfg || !Array.isArray(cfg.bridges) || cfg.bridges.length === 0) {
      console.error("bridges config must have a non-empty \"bridges\" array"); process.exit(1);
    }
    const ids = new Set(), labels = new Set(), homes = new Set();
    for (const b of cfg.bridges) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(b.id || "")) { console.error("bad profile id: " + JSON.stringify(b.id)); process.exit(1); }
      if (!["claude","codex"].includes(b.runtime)) { console.error(b.id + ": bad runtime " + JSON.stringify(b.runtime)); process.exit(1); }
      if (typeof b.home !== "string" || !path.isAbsolute(b.home)) { console.error(b.id + ": home must be absolute"); process.exit(1); }
      if (!/^[A-Za-z0-9.-]+$/.test(b.launchdLabel || "")) { console.error(b.id + ": bad launchdLabel"); process.exit(1); }
      if (ids.has(b.id) || labels.has(b.launchdLabel) || homes.has(path.normalize(b.home))) {
        console.error("duplicate id/label/home around profile " + b.id); process.exit(1);
      }
      ids.add(b.id); labels.add(b.launchdLabel); homes.add(path.normalize(b.home));
      console.log([b.id, b.runtime, b.home, b.launchdLabel].join("\t"));
    }
  ' "$CONFIG"
}

PROFILES="$(profiles_tsv)"

if [ "$CMD" = "list" ]; then
  printf 'ID\tRUNTIME\tHOME\tLAUNCHD_LABEL\n%s\n' "$PROFILES" | column -t -s $'\t'
  exit 0
fi

run_one() {
  local id="$1" runtime="$2" home="$3" label="$4"
  echo "── profile: $id (runtime=$runtime) ──"
  case "$CMD" in
    doctor)
      # A disabled launchd label is the most common silent failure — check it before doctor.sh.
      local uid; uid="$(id -u)"
      if launchctl print-disabled "gui/$uid" 2>/dev/null | grep -q "\"$label\" => disabled"; then
        echo "[FAIL] launchd label $label is DISABLED — fix: launchctl enable gui/$uid/$label"
      else
        echo "[OK]   launchd label $label not disabled"
      fi
      if [ ! -f "$home/config.env" ]; then
        echo "[FAIL] $home/config.env missing"
      else
        local perms; perms="$(stat -f '%Lp' "$home/config.env" 2>/dev/null || stat -c '%a' "$home/config.env" 2>/dev/null)"
        if [ "$perms" = "600" ]; then
          echo "[OK]   config.env exists with 600 permissions"
        else
          echo "[WARN] config.env permissions are $perms (expected 600)"
        fi
      fi
      CTI_HOME="$home" CTI_LAUNCHD_LABEL="$label" bash "$SKILL_DIR/scripts/doctor.sh" || true
      ;;
    logs)
      CTI_HOME="$home" CTI_LAUNCHD_LABEL="$label" bash "$SKILL_DIR/scripts/daemon.sh" logs
      ;;
    *)
      CTI_HOME="$home" CTI_LAUNCHD_LABEL="$label" bash "$SKILL_DIR/scripts/daemon.sh" "$CMD"
      ;;
  esac
  echo
}

FOUND=0
while IFS=$'\t' read -r id runtime home label; do
  [ -n "$id" ] || continue
  if [ "$TARGET" = "all" ] || [ "$TARGET" = "$id" ]; then
    FOUND=1
    run_one "$id" "$runtime" "$home" "$label"
  fi
done <<< "$PROFILES"

if [ "$FOUND" = "0" ]; then
  echo "unknown profile: $TARGET" >&2
  echo "known profiles:" >&2
  printf '%s\n' "$PROFILES" | cut -f1 | sed 's/^/  - /' >&2
  exit 1
fi
