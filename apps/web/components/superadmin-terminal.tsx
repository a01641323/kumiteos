"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BeltColor } from "@karate/core";
import {
  BELT_LABEL_EN,
  BELT_ORDER,
  newCategoryDefId,
  findCategoryForParticipant,
  parseParticipantsCsv,
  stringifyParticipantsCsv,
  buildAreaPlan,
} from "@karate/core";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { useOverlay } from "@/lib/overlay-context";
import { useNetwork } from "@/lib/network-context";
import {
  adminGetLicenses,
  adminCreateLicense,
  adminRevokeLicense,
  adminTransferLicense,
  adminExtendLicense,
  adminGetAppConfig,
  adminUpdateAppConfig,
  adminUploadLogo,
  adminRemoveLogo,
} from "@/lib/admin-api-client";
import { apiGetLogoInfo, logoSrc } from "@/lib/api-client";

// ─── types ───────────────────────────────────────────────────────────────────

type LineKind = "cmd" | "out" | "err" | "hi" | "dim";
type Line = { kind: LineKind; text: string; id: number };
type Wizard = {
  kind: WizardKind;
  prompts: string[];
  step: number;
  collected: string[];
};
type WizardKind =
  | "competitor-add"
  | "category-add"
  | "license-create"
  | "license-extend"
  | "seed-set"
  | "ttl-set"
  | "setup-size"
  | "setup-mode"
  | "setup-pointdiff"
  | "areas-set"
  | "area-assign"
  | "confirm";

// ─── helpers ─────────────────────────────────────────────────────────────────

let _id = 0;
const ln = (kind: LineKind, text: string): Line => ({ kind, text, id: _id++ });

const BELT_KEYS = BELT_ORDER as BeltColor[];
const beltMenu = BELT_KEYS.map((b, i) => `${i + 1}=${BELT_LABEL_EN[b]}`).join("  ");

function parseBelts(raw: string): BeltColor[] {
  if (raw.trim().toLowerCase() === "all") return [...BELT_KEYS];
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= BELT_KEYS.length);
  return [...new Set(nums.map((n) => BELT_KEYS[n - 1]))];
}

// ─── banner ───────────────────────────────────────────────────────────────────

const BANNER: Line[] = [
  ln("dim", "╔══════════════════════════════════════════════╗"),
  ln("dim", "║   KARATE TOURNAMENT  ·  ADMIN TERMINAL       ║"),
  ln("dim", "║   *** AUTHORIZED ACCESS ONLY ***             ║"),
  ln("dim", "╚══════════════════════════════════════════════╝"),
  ln("out", ""),
  ln("out", 'Type "help" to list all commands.'),
  ln("out", ""),
];

// ─── component ───────────────────────────────────────────────────────────────

export function SuperadminTerminal() {
  const [lines, setLines] = useState<Line[]>(BANNER);
  const [input, setInput] = useState("");
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [pendingWizardKind, setPendingWizardKind] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const pendingConfirmActionRef = useRef<(() => Promise<void>) | null>(null);

  const { getLocalAdminToken } = useOverlay();
  const {
    state,
    addParticipant,
    removeParticipant,
    replaceParticipants,
    addCategoryDef,
    removeCategoryDef,
    reseed,
    applyTournamentSettings,
    setAreaCount,
    assignSubcategoryToArea,
    loadMockTournament,
    setLogoUrl,
    resetScoreboard,
    wipeData,
  } = useStore();
  const { token: authToken } = useAuth();
  const { status: netStatus, isElectron } = useNetwork();

  // ─── output helpers ─────────────────────────────────────────────────────

  const print = useCallback((kind: LineKind, text: string) => {
    setLines((prev) => [...prev, ln(kind, text)]);
  }, []);

  const prints = useCallback((kind: LineKind, texts: string[]) => {
    setLines((prev) => [...prev, ...texts.map((t) => ln(kind, t))]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Show auth status on mount so we know immediately if the token is set.
  useEffect(() => {
    const tok = getLocalAdminToken();
    if (tok) {
      setLines((prev) => [...prev, ln("dim", `auth: token OK (${tok.slice(0, 8)}…)`)]);
    } else {
      setLines((prev) => [...prev, ln("err", "auth: NO TOKEN — admin commands will fail")]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── wizard ─────────────────────────────────────────────────────────────

  function startWizard(kind: WizardKind, prompts: string[]) {
    setWizard({ kind, prompts, step: 0, collected: [] });
    print("dim", prompts[0]);
  }

  function askConfirm(warningLines: string[], action: () => Promise<void>) {
    pendingConfirmActionRef.current = action;
    prints("err", warningLines);
    startWizard("confirm", ['Type "yes" to confirm, or anything else to cancel:']);
  }

  const finishWizard = useCallback(
    async (kind: WizardKind, data: string[]) => {
      const tok = getLocalAdminToken();
      const t = state.tournament;

      if (kind === "confirm") {
        const action = pendingConfirmActionRef.current;
        pendingConfirmActionRef.current = null;
        if (data[0].trim().toLowerCase() === "yes" && action) {
          await action();
        } else {
          print("dim", "Cancelled.");
        }
        return;
      }

      if (kind === "competitor-add") {
        const [nombre, apellido, beltRaw, ageRaw] = data;
        const belts = parseBelts(beltRaw);
        const belt: BeltColor = belts[0] ?? "white";
        const age = parseInt(ageRaw, 10) || 10;
        addParticipant({ nombre, apellido, beltColor: belt, age });
        print("hi", `✓ Competitor added: ${nombre} ${apellido} · ${BELT_LABEL_EN[belt]} · age ${age}`);
      }

      else if (kind === "category-add") {
        const [name, beltRaw, minAgeRaw, maxAgeRaw] = data;
        const belts = parseBelts(beltRaw);
        const minAge = parseInt(minAgeRaw, 10) || 0;
        const maxAge = maxAgeRaw.trim() === "" ? null : parseInt(maxAgeRaw, 10);
        addCategoryDef({ id: newCategoryDefId(), name, belts, minAge, maxAge });
        print("hi", `✓ Category "${name}" added.`);
      }

      else if (kind === "license-create") {
        if (!tok) { print("err", "ERR: no admin token"); return; }
        const [label, minutesRaw] = data;
        const ttlMinutes = parseInt(minutesRaw, 10) || 43200;
        try {
          const r = await adminCreateLicense(tok, { label, ttlMinutes });
          print("out", "");
          print("hi",  "┌─────────────────────────────────┐");
          print("hi",  `│  CODE: ${r.code}                   │`);
          print("hi",  `│  Label: ${r.label}`);
          print("hi",  `│  Expires: ${new Date(r.expiresAt).toLocaleDateString()}`);
          print("hi",  "└─────────────────────────────────┘");
          print("dim", "(shown once — copy it now)");
          print("out", "");
        } catch (e) {
          print("err", `ERR: ${(e as Error).message}`);
        }
      }

      else if (kind === "license-extend") {
        if (!tok) { print("err", "ERR: no admin token"); return; }
        const [userId, minutesRaw] = data;
        const minutes = parseInt(minutesRaw, 10);
        if (!minutes || minutes < 1) { print("err", "ERR: invalid number of minutes"); return; }
        try {
          const r = await adminExtendLicense(tok, userId, minutes);
          print("hi", `✓ Extended until ${new Date(r.expiresAt).toLocaleDateString()}`);
        } catch (e) {
          print("err", `ERR: ${(e as Error).message}`);
        }
      }

      else if (kind === "seed-set") {
        const [raw] = data;
        const n = Number(raw);
        if (!Number.isFinite(n)) { print("err", "ERR: seed must be a number"); return; }
        reseed(Math.floor(n), true);
        print("hi", `✓ Seed set to ${Math.floor(n)}`);
      }

      else if (kind === "ttl-set") {
        if (!tok) { print("err", "ERR: no admin token"); return; }
        const [raw] = data;
        const v = parseInt(raw, 10);
        if (!v || v < 1) { print("err", "ERR: must be a positive integer"); return; }
        try {
          await adminUpdateAppConfig(tok, v);
          print("hi", `✓ Kiosk session TTL set to ${v} minutes`);
        } catch (e) {
          print("err", `ERR: ${(e as Error).message}`);
        }
      }

      else if (kind === "setup-size") {
        const [raw] = data;
        const n = parseInt(raw, 10) as 4 | 8 | 16;
        if (![4, 8, 16].includes(n)) { print("err", "ERR: must be 4, 8, or 16"); return; }
        const s = t.settings;
        applyTournamentSettings(n, s.disciplineMode, s.pointDifference ?? 8, true);
        print("hi", `✓ Group size set to ${n}`);
      }

      else if (kind === "setup-mode") {
        const [raw] = data;
        const mode = raw.trim().toLowerCase();
        if (!["combat", "kata", "both"].includes(mode)) {
          print("err", "ERR: must be combat, kata, or both"); return;
        }
        const s = t.settings;
        applyTournamentSettings(s.subcategorySize, mode as "combat" | "kata" | "both", s.pointDifference ?? 8, true);
        print("hi", `✓ Discipline mode set to ${mode}`);
      }

      else if (kind === "setup-pointdiff") {
        const [raw] = data;
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 0) { print("err", "ERR: must be 0 or a positive integer"); return; }
        const s = t.settings;
        applyTournamentSettings(s.subcategorySize, s.disciplineMode, n, true);
        print("hi", `✓ Point-difference auto-finish set to ${n}${n === 0 ? " (disabled)" : ""}`);
      }

      else if (kind === "areas-set") {
        const [raw] = data;
        const n = Math.max(1, Math.min(10, parseInt(raw, 10) || 1));
        setAreaCount(n);
        print("hi", `✓ Competition areas set to ${n}`);
      }

      else if (kind === "area-assign") {
        const [subId, areaRaw] = data;
        const areaIdx = parseInt(areaRaw, 10);
        if (isNaN(areaIdx) || areaIdx < 0) { print("err", "ERR: invalid area index"); return; }
        assignSubcategoryToArea(subId, areaIdx);
        print("hi", `✓ Subcategory ${subId} → Area ${areaIdx + 1}`);
      }
    },
    [getLocalAdminToken, state, addParticipant, addCategoryDef, reseed,
     applyTournamentSettings, setAreaCount, assignSubcategoryToArea, print]
  );

  // ─── wizard input step ──────────────────────────────────────────────────

  async function advanceWizard(value: string) {
    if (!wizard) return;
    const collected = [...wizard.collected, value];
    const nextStep = wizard.step + 1;
    if (nextStep < wizard.prompts.length) {
      setWizard({ ...wizard, step: nextStep, collected });
      print("dim", wizard.prompts[nextStep]);
    } else {
      setWizard(null);
      await finishWizard(wizard.kind, collected);
    }
  }

  // ─── command handlers ────────────────────────────────────────────────────

  const runCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      print("cmd", `> ${trimmed}`);
      setHistory((h) => [trimmed, ...h.slice(0, 49)]);
      setHistIdx(-1);

      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const sub = parts[1]?.toLowerCase() ?? "";
      const arg = parts.slice(2).join(" ");
      const tok = getLocalAdminToken();

      // ── help ──────────────────────────────────────────────────────────
      if (cmd === "help") {
        prints("dim", [
          "",
          "═══════════════════ GENERAL ═══════════════════",
          "  help                      this screen",
          "  clear                     clear terminal",
          "  demo                      load demo tournament (replaces data)",
          "",
          "═══════════════════ LICENSES ══════════════════",
          "  license list              list all licenses & session TTL",
          "  license create            generate a new claim code (wizard)",
          "  license revoke <# or label>   revoke a license",
          "  license transfer <# or label> reset machine fingerprint",
          "  license extend <# or label>   extend expiry (wizard)",
          "  ttl set <minutes>         set kiosk session TTL",
          "",
          "═══════════════════ CATEGORIES ════════════════",
          "  category list             list all categories",
          "  category add              add category (wizard)",
          "  category delete <name>    delete category by name",
          "",
          "═══════════════════ COMPETITORS ═══════════════",
          "  competitor list [cat]     list competitors (optional filter)",
          "  competitor add            add a competitor (wizard)",
          "  competitor remove <#>     remove competitor by list number",
          "  competitor import         open file picker for CSV import",
          "  competitor export         download CSV",
          "",
          "═══════════════════ SEEDING ════════════════════",
          "  seed                      show current seed",
          "  seed new                  random reseed (resets brackets)",
          "  seed set <value>          set explicit seed (no reset)",
          "",
          "═══════════════════ SETUP ══════════════════════",
          "  setup                     show tournament settings",
          "  setup size <4|8|16>       set subcategory group size (resets brackets)",
          "  setup mode <combat|kata|both>  set discipline mode (resets brackets)",
          "  setup pointdiff <n>       point-difference auto-win (0 = disabled)",
          "  areas set <n>             set number of competition areas (1-10)",
          "  areas list                list area subcategory assignments",
          "  area assign <subId> <n>   assign subcategory to area (0-indexed)",
          "",
          "═══════════════════ SCOREBOARD ═════════════════",
          "  reset scoreboard          reset live match scores to zero",
          "",
          "═══════════════════ DANGER ZONE ════════════════",
          "  wipe                      preview the data wipe",
          "  wipe confirm              remove participants, brackets,",
          "                            area assignments, scoreboard",
          "",
          "═══════════════════ LOGO ═══════════════════════",
          "  logo                      show current logo info",
          "  logo upload               open file picker (PNG/JPG/SVG, max 2MB)",
          "  logo remove               remove current logo",
          "",
          "═══════════════════ BUNDLE EXPORT ══════════════",
          "  export-bundle [label]     download tournament as JSON",
          "                            ready to upload to /admin",
          "",
          "═══════════════════ NETWORK ════════════════════",
          "  net status                show network mode & connected clients",
          "  net server                make this computer the server",
          "  net standalone            switch to standalone mode",
          "  net scan                  list discovered servers on LAN",
          "  net connect <serverId>    connect to a discovered server",
          "  net disconnect            disconnect all clients (server mode)",
          "",
        ]);
        return;
      }

      // ── diag ──────────────────────────────────────────────────────────
      if (cmd === "diag") {
        const serverUrl = typeof window !== "undefined"
          ? (window.__KARATE__?.serverUrl ?? "(not set — will use default port)")
          : "(server-side)";
        const tok = getLocalAdminToken();
        print("out", `server url : ${serverUrl}`);
        print("out", `token      : ${tok ? tok.slice(0, 8) + "…" : "NULL"}`);
        try {
          const res = await fetch(serverUrl + "/api/admin/licenses", {
            cache: "no-store",
            headers: tok ? { "X-Karate-Local-Admin": tok } : {},
          });
          const body = await res.text();
          print("out", `admin ping  : ${res.status} ${res.statusText}`);
          print("dim", `response    : ${body.slice(0, 120)}`);
        } catch (e) {
          print("err", `admin ping  : FAILED — ${(e as Error).message}`);
        }
        return;
      }

      // ── clear ─────────────────────────────────────────────────────────
      if (cmd === "clear") {
        setLines(BANNER);
        return;
      }

      // ── demo ──────────────────────────────────────────────────────────
      if (cmd === "demo") {
        askConfirm(
          ["⚠ This will replace all participants and categories with demo data."],
          async () => {
            loadMockTournament(true);
            print("hi", "✓ Demo tournament loaded.");
          }
        );
        return;
      }

      // ── reset ─────────────────────────────────────────────────────────
      if (cmd === "reset") {
        if (sub === "scoreboard") {
          askConfirm(
            ["⚠ This will clear all live match scores (points, penalties, timer)."],
            async () => {
              resetScoreboard(true);
              print("hi", "✓ Scoreboard reset.");
            }
          );
          return;
        }
        print("err", "Usage: reset scoreboard");
        return;
      }

      // ── wipe ──────────────────────────────────────────────────────────
      // Removes the tournament's runtime data — participants, brackets,
      // area assignments, scoreboard. Keeps:
      //   - category definitions (the schema)
      //   - tournament settings (subcategory size, discipline mode, areas)
      //   - licenses + kiosk session + uploaded logo
      // Single-stage with explicit `wipe confirm` to avoid an accidental
      // double-Enter destroying the day's work.
      if (cmd === "wipe") {
        if (sub !== "confirm") {
          const pCount = state.tournament.participants.length;
          const catsWithBrackets = state.tournament.categoryOrder.filter((id) =>
            (state.tournament.categories[id]?.subcategories.length ?? 0) > 0,
          ).length;
          prints("err", [
            "⚠ This will REMOVE all tournament data:",
            `   · ${pCount} participant${pCount === 1 ? "" : "s"}`,
            `   · ${catsWithBrackets} categor${catsWithBrackets === 1 ? "y" : "ies"} with brackets`,
            "   · all area assignments",
            "   · the live scoreboard",
            "",
            "Settings, category definitions, licenses and the logo are kept.",
            "There is NO UNDO.",
            "",
          ]);
          print("dim", "To proceed, run:  wipe confirm");
          return;
        }
        askConfirm(
          ["⚠ FINAL CHECK — wipe everything now?"],
          async () => {
            wipeData();
            print("hi", "✓ Tournament data wiped. Settings + license preserved.");
          },
        );
        return;
      }

      // ── license ───────────────────────────────────────────────────────
      if (cmd === "license") {
        if (sub === "list") {
          if (!tok) { print("err", "ERR: no admin token"); return; }
          try {
            const [{ licenses }, cfg] = await Promise.all([
              adminGetLicenses(tok),
              adminGetAppConfig(tok),
            ]);
            print("out", `Kiosk session TTL: ${cfg.sessionTtlMinutes} min`);
            print("out", "");
            if (licenses.length === 0) {
              print("dim", "(no licenses)");
            } else {
              print("dim", "  #  CODE   LABEL                    STATUS    EXPIRES     MACHINE");
              licenses.forEach((l, i) => {
                const exp = new Date(l.expiresAt).toLocaleDateString();
                const fp = l.machineFingerprintTail ?? "—";
                const code = l.code || l.codePreview || "??????";
                const row = `  ${String(i + 1).padEnd(3)}${code.padEnd(7)}${l.label.slice(0, 24).padEnd(25)}${l.status.padEnd(10)}${exp.padEnd(12)}${fp}`;
                print(l.status === "active" ? "hi" : l.status === "revoked" ? "err" : "out", row);
              });
            }
            print("out", "");
          } catch (e) {
            print("err", `ERR: ${(e as Error).message}`);
          }
          return;
        }

        if (sub === "create") {
          startWizard("license-create", [
            "Label (e.g. Club Guadalajara – Area 1):",
            "Expiry in minutes [43200 = 30 days]:",
          ]);
          return;
        }

        if (sub === "revoke" || sub === "transfer" || sub === "extend") {
          const ref = arg.trim();
          if (!ref) { print("err", `Usage: license ${sub} <# or label>`); return; }
          if (!tok) { print("err", "ERR: no admin token"); return; }
          try {
            const { licenses: list } = await adminGetLicenses(tok);
            const idx = parseInt(ref, 10);
            const match = Number.isFinite(idx) && idx >= 1 && idx <= list.length
              ? list[idx - 1]
              : list.find((l) => l.label.trim().toLowerCase() === ref.toLowerCase());
            if (!match) { print("err", `ERR: no license "${ref}" — use the # from license list`); return; }
            if (sub === "revoke") {
              askConfirm(
                [`⚠ Revoking "${match.label}" — the registered device will lose access on next renewal.`],
                async () => {
                  await adminRevokeLicense(tok!, match.userId);
                  print("hi", `✓ License "${match.label}" revoked.`);
                }
              );
            } else if (sub === "transfer") {
              askConfirm(
                [`⚠ This will reset the machine fingerprint for "${match.label}". The code becomes reclaimable on a new device.`],
                async () => {
                  await adminTransferLicense(tok!, match.userId);
                  print("hi", `✓ "${match.label}" fingerprint reset. Reclaimable on a new device.`);
                }
              );
            } else {
              setWizard({ kind: "license-extend", prompts: ["Minutes to extend by [43200 = 30 days]:"], step: 0, collected: [match.userId] });
              print("dim", "Minutes to extend by [43200 = 30 days]:");
            }
          } catch (e) {
            print("err", `ERR: ${(e as Error).message}`);
          }
          return;
        }

        print("err", "Unknown license subcommand. See 'help'.");
        return;
      }

      // ── ttl ───────────────────────────────────────────────────────────
      if (cmd === "ttl") {
        if (sub === "set") {
          const val = arg || parts[2];
          if (val) {
            setWizard({ kind: "ttl-set", prompts: [], step: 0, collected: [] });
            await finishWizard("ttl-set", [val]);
          } else {
            startWizard("ttl-set", ["New TTL in minutes:"]);
          }
          return;
        }
        print("err", "Usage: ttl set <minutes>");
        return;
      }

      // ── category ──────────────────────────────────────────────────────
      if (cmd === "category") {
        if (sub === "list") {
          const defs = state.tournament.categoryDefs;
          if (defs.length === 0) { print("dim", "(no categories)"); return; }
          print("dim", "  #  NAME                    BELTS                     AGES");
          defs.forEach((d, i) => {
            const belts = d.belts.length === 0 ? "any" : d.belts.map((b) => BELT_LABEL_EN[b]).join(", ");
            const ages = `${d.minAge}–${d.maxAge ?? "∞"}`;
            print("out", `  ${String(i + 1).padEnd(3)}${d.name.slice(0, 23).padEnd(24)}${belts.slice(0, 25).padEnd(26)}${ages}`);
          });
          print("out", "");
          return;
        }

        if (sub === "add") {
          startWizard("category-add", [
            "Name (e.g. Yellow 4-6):",
            `Belts — ${beltMenu}  (numbers, space-separated, or "all"):`,
            "Min age:",
            "Max age (leave blank for no limit):",
          ]);
          return;
        }

        if (sub === "delete") {
          const name = parts.slice(2).join(" ");
          if (!name) { print("err", "Usage: category delete <name>"); return; }
          const def = state.tournament.categoryDefs.find(
            (d) => d.name.toLowerCase() === name.toLowerCase()
          );
          if (!def) { print("err", `ERR: category "${name}" not found`); return; }
          askConfirm(
            [`⚠ Deleting "${def.name}" — participants in this category will become unassigned.`],
            async () => {
              removeCategoryDef(def.id, true);
              print("hi", `✓ Category "${def.name}" deleted.`);
            }
          );
          return;
        }

        print("err", "Unknown category subcommand. See 'help'.");
        return;
      }

      // ── competitor ────────────────────────────────────────────────────
      if (cmd === "competitor") {
        if (sub === "list") {
          const defs = state.tournament.categoryDefs;
          const participants = state.tournament.participants;
          let list = participants;
          if (arg) {
            list = participants.filter((p) => {
              const def = findCategoryForParticipant(defs, p);
              return def?.name.toLowerCase().includes(arg.toLowerCase());
            });
          }
          if (list.length === 0) { print("dim", "(no competitors)"); return; }
          print("dim", "  #   NAME                      BELT           AGE  CATEGORY");
          list.forEach((p, i) => {
            const def = findCategoryForParticipant(defs, p);
            const cat = def?.name ?? "Unassigned";
            print("out", `  ${String(i + 1).padEnd(4)}${`${p.nombre} ${p.apellido}`.slice(0, 25).padEnd(26)}${BELT_LABEL_EN[p.beltColor].padEnd(15)}${String(p.age).padEnd(5)}${cat}`);
          });
          print("out", `  Total: ${list.length}`);
          print("out", "");
          return;
        }

        if (sub === "add") {
          startWizard("competitor-add", [
            "Name (first name):",
            "Surname:",
            `Belt — ${beltMenu}  (enter number):`,
            "Age:",
          ]);
          return;
        }

        if (sub === "remove") {
          const idx = parseInt(parts[2], 10) - 1;
          const p = state.tournament.participants[idx];
          if (!p) { print("err", `ERR: no competitor at position ${idx + 1}`); return; }
          removeParticipant(p.id);
          print("hi", `✓ Removed: ${p.nombre} ${p.apellido}`);
          return;
        }

        if (sub === "import") {
          setPendingWizardKind("csv-import");
          csvRef.current?.click();
          print("dim", "Opening file picker…");
          return;
        }

        if (sub === "export") {
          const csv = stringifyParticipantsCsv(state.tournament.participants);
          const blob = new Blob([csv], { type: "text/csv" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `karate-participants-${Date.now()}.csv`;
          a.click();
          URL.revokeObjectURL(a.href);
          print("hi", `✓ Exported ${state.tournament.participants.length} competitors.`);
          return;
        }

        print("err", "Unknown competitor subcommand. See 'help'.");
        return;
      }

      // ── export-bundle ─────────────────────────────────────────────────
      // Builds the v1 tournament-bundle JSON the admin uploads at
      // /admin/requests grant time. Logo is captured as a data URL so
      // the bundle is self-contained (no extra fetch required).
      if (cmd === "export-bundle") {
        const t = state.tournament;
        const labelArg = parts.slice(1).join(" ").trim();
        const fallbackLabel = `Kumite/OS export · ${new Date().toLocaleDateString()}`;
        const label = labelArg || fallbackLabel;
        const bundle = {
          bundleVersion: 1,
          label,
          preparedAt: new Date().toISOString(),
          categoryDefs: t.categoryDefs,
          participants: t.participants.map(({ id: _id, ...rest }) => rest),
          settings: {
            subcategorySize: t.settings.subcategorySize,
            disciplineMode: t.settings.disciplineMode,
            areaCount: t.settings.areaCount,
            pointDifference: t.settings.pointDifference,
          },
          logoDataUrl: typeof t.meta.logoUrl === "string" && t.meta.logoUrl.startsWith("data:")
            ? t.meta.logoUrl
            : null,
        };
        const serialized = JSON.stringify(bundle, null, 2);
        const sizeKB = Math.round(new Blob([serialized]).size / 1024);
        const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bundle";
        const filename = `tournament-${safeLabel}.json`;
        const blob = new Blob([serialized], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        print("hi", `✓ Exported bundle "${label}" (${sizeKB} KB → ${filename})`);
        print("dim", `  ${bundle.participants.length} competitors · ${bundle.categoryDefs.length} categories · ${bundle.logoDataUrl ? "logo embedded" : "no logo"}`);
        if (!bundle.logoDataUrl && t.meta.logoUrl) {
          print("dim", "  (logo not embedded — server-hosted URLs aren't portable; re-upload via 'logo upload' for the bundle to carry it.)");
        }
        if (sizeKB > 500) {
          print("err", `⚠ ${sizeKB} KB is close to the 600 KB cloud cap — shrink the logo if upload is rejected.`);
        }
        return;
      }

      // ── seed ──────────────────────────────────────────────────────────
      if (cmd === "seed") {
        if (!sub || sub === "show") {
          print("out", `Current seed: ${state.tournament.meta.seed}`);
          return;
        }
        if (sub === "new") {
          askConfirm(
            ["⚠ This will reset all bracket progress and randomly reassign competitors."],
            async () => {
              reseed(undefined, true);
              print("hi", `✓ New seed: ${state.tournament.meta.seed}`);
            }
          );
          return;
        }
        if (sub === "set") {
          if (parts[2]) {
            await finishWizard("seed-set", [parts[2]]);
          } else {
            startWizard("seed-set", ["New seed value (integer):"]);
          }
          return;
        }
        print("err", "Usage: seed | seed new | seed set <value>");
        return;
      }

      // ── setup ─────────────────────────────────────────────────────────
      if (cmd === "setup") {
        const s = state.tournament.settings;
        if (!sub) {
          print("out", "");
          print("out", `  Group size:       ${s.subcategorySize}`);
          print("out", `  Discipline mode:  ${s.disciplineMode}`);
          print("out", `  Point-diff limit: ${s.pointDifference ?? 0} (0 = disabled)`);
          print("out", `  Area count:       ${s.areaCount}`);
          print("out", "");
          return;
        }
        if (sub === "size") {
          const newSize = parts[2] ? parseInt(parts[2], 10) : null;
          const doIt = async () => {
            if (newSize) await finishWizard("setup-size", [String(newSize)]);
            else startWizard("setup-size", ["Group size (4, 8, or 16):"]);
          };
          if (newSize && newSize !== s.subcategorySize && state.tournament.categoryOrder.length > 0) {
            askConfirm(
              ["⚠ Changing group size will reset all bracket progress."],
              doIt
            );
          } else {
            await doIt();
          }
          return;
        }
        if (sub === "mode") {
          const newMode = parts[2]?.toLowerCase();
          const doIt = async () => {
            if (newMode) await finishWizard("setup-mode", [newMode]);
            else startWizard("setup-mode", ["Discipline mode (combat / kata / both):"]);
          };
          if (newMode && newMode !== s.disciplineMode && state.tournament.categoryOrder.length > 0) {
            askConfirm(
              ["⚠ Changing discipline mode will reset all bracket progress."],
              doIt
            );
          } else {
            await doIt();
          }
          return;
        }
        if (sub === "pointdiff") {
          if (parts[2]) { await finishWizard("setup-pointdiff", [parts[2]]); }
          else { startWizard("setup-pointdiff", ["Point-difference limit (0 to disable):"]); }
          return;
        }
        print("err", "Usage: setup | setup size | setup mode | setup pointdiff");
        return;
      }

      // ── areas ─────────────────────────────────────────────────────────
      if (cmd === "areas") {
        if (sub === "set") {
          if (parts[2]) { await finishWizard("areas-set", [parts[2]]); }
          else { startWizard("areas-set", ["Number of competition areas (1–10):"]); }
          return;
        }
        if (!sub || sub === "list") {
          const { areas } = buildAreaPlan(
            {
              categoryOrder: state.tournament.categoryOrder,
              categories: state.tournament.categories,
              areaCount: state.tournament.settings.areaCount,
            },
            state.tournament.areaAssignments
          );
          print("out", "");
          areas.forEach((a) => {
            print("hi", `  ${a.label} (${a.subcategoryIds.length} subcategories)`);
            a.subcategoryIds.forEach((subId) => {
              for (const catId of state.tournament.categoryOrder) {
                const cat = state.tournament.categories[catId];
                const sub2 = cat?.subcategories.find((s) => s.id === subId);
                if (sub2) {
                  print("out", `    ${subId}  →  ${cat?.name} · ${sub2.label}`);
                  break;
                }
              }
            });
            if (a.subcategoryIds.length === 0) print("dim", "    (empty)");
          });
          print("out", "");
          return;
        }
        print("err", "Usage: areas list | areas set <n>");
        return;
      }

      // ── area assign ───────────────────────────────────────────────────
      if (cmd === "area") {
        if (sub === "assign") {
          if (parts[2] && parts[3]) {
            await finishWizard("area-assign", [parts[2], parts[3]]);
          } else {
            startWizard("area-assign", [
              "Subcategory ID (from 'areas list'):",
              "Area index (0-based):",
            ]);
          }
          return;
        }
        print("err", "Usage: area assign <subId> <areaIndex>");
        return;
      }

      // ── logo ──────────────────────────────────────────────────────────
      if (cmd === "logo") {
        if (!sub) {
          if (!authToken) { print("err", "ERR: not authenticated"); return; }
          try {
            const r = await apiGetLogoInfo(authToken);
            if (!r.logo) { print("out", "No logo set."); }
            else {
              print("out", `  File:  ${r.logo.filename}`);
              print("out", `  Size:  ${(r.logo.size / 1024).toFixed(1)} KB`);
            }
          } catch (e) {
            print("err", `ERR: ${(e as Error).message}`);
          }
          return;
        }
        if (sub === "upload") {
          setPendingWizardKind("logo-upload");
          logoRef.current?.click();
          print("dim", "Opening file picker…");
          return;
        }
        if (sub === "remove") {
          const adminTok = getLocalAdminToken();
          if (!adminTok) { print("err", "ERR: no admin token"); return; }
          askConfirm(
            ["⚠ This will permanently remove the current logo."],
            async () => {
              try {
                await adminRemoveLogo(adminTok);
                setLogoUrl(null);
                print("hi", "✓ Logo removed.");
              } catch (e) {
                print("err", `ERR: ${(e as Error).message}`);
              }
            }
          );
          return;
        }
        print("err", "Usage: logo | logo upload | logo remove");
        return;
      }

      // ── net ───────────────────────────────────────────────────────────
      if (cmd === "net") {
        const net = typeof window !== "undefined" ? window.__KARATE__?.network : null;
        if (!sub || sub === "status") {
          print("out", `  Mode:    ${netStatus.mode}`);
          if (netStatus.serverInfo) {
            print("out", `  IP:      ${netStatus.serverInfo.serverIp ?? "(none)"}`);
            print("out", `  Port:    ${netStatus.serverInfo.serverPort}`);
          }
          print("out", `  Clients: ${netStatus.clients.length}`);
          netStatus.clients.forEach((c) => {
            print("dim", `    ${c.hostname ?? "(unknown)"}  rtt:${c.rttMs ?? "?"}ms`);
          });
          const pendingCount = netStatus.pending?.length ?? 0;
          if (pendingCount > 0) {
            print("hi", `  Pending: ${pendingCount} (use 'net pending')`);
          }
          if (!isElectron) print("dim", "  (network only available in desktop app)");
          return;
        }
        if (sub === "pending") {
          if (!net) { print("err", "ERR: network not available (desktop only)"); return; }
          const list = await net.listPending();
          if (list.length === 0) { print("dim", "No pending connection requests."); return; }
          print("dim", "  CLIENTID                  HOSTNAME             IP");
          list.forEach((p) => {
            print("out", `  ${p.clientId.slice(0, 24).padEnd(26)}${(p.hostname ?? "(unknown)").slice(0, 20).padEnd(21)}${p.ip}`);
          });
          print("dim", "  (use the modal to accept/reject)");
          return;
        }
        if (!net) { print("err", "ERR: network not available (desktop only)"); return; }
        if (sub === "server") {
          const r = await net.setMode("server");
          if (!r.ok) { print("err", `ERR: ${r.error}`); return; }
          print("hi", "✓ Now operating as server.");
          return;
        }
        if (sub === "standalone") {
          const r = await net.setMode("standalone");
          if (!r.ok) { print("err", `ERR: ${r.error}`); return; }
          print("hi", "✓ Standalone mode.");
          return;
        }
        if (sub === "scan") {
          const list = await net.listDiscoveredServers();
          if (list.length === 0) { print("dim", "No servers found on LAN."); return; }
          print("dim", "  SERVERID                  IP               PORT  TOURNAMENT");
          list.forEach((d) => {
            print("out", `  ${d.serverId.slice(0, 24).padEnd(26)}${d.serverIp.padEnd(17)}${String(d.serverPort).padEnd(6)}${d.tournamentName ?? "—"}`);
          });
          return;
        }
        if (sub === "connect") {
          const serverId = parts.slice(2).join(" ");
          if (!serverId) { print("err", "Usage: net connect <serverId>"); return; }
          await net.setMode("client");
          await net.connectTo(serverId);
          print("hi", `✓ Connecting to ${serverId}…`);
          return;
        }
        if (sub === "disconnect") {
          await net.disconnectAllClients();
          print("hi", "✓ All clients disconnected.");
          return;
        }
        print("err", "Unknown net subcommand. See 'help'.");
        return;
      }

      print("err", `Unknown command: "${cmd}". Type "help" for the full list.`);
    },
    [
      getLocalAdminToken, state, print, prints, startWizard, finishWizard,
      loadMockTournament, removeParticipant, replaceParticipants,
      removeCategoryDef, reseed, setAreaCount, setLogoUrl, authToken,
      netStatus, isElectron, resetScoreboard,
    ]
  );

  // ─── key handler ────────────────────────────────────────────────────────

  async function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? "" : history[idx] ?? "");
    } else if (e.key === "Enter") {
      e.preventDefault();
      const val = input.trim();
      setInput("");
      if (!val && !wizard) return;

      if (wizard) {
        if (val) print("cmd", val);
        await advanceWizard(val || "");
      } else {
        await runCommand(val);
      }
    }
  }

  // ─── file handlers ───────────────────────────────────────────────────────

  function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) { print("err", "No file selected."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const result = parseParticipantsCsv(text);
      const existing = state.tournament.participants.length;
      if (existing > 0) {
        askConfirm(
          [
            `⚠ This will replace ${existing} existing competitor(s) with ${result.participants.length} from the CSV file.`,
            "  All bracket progress will be reset.",
          ],
          async () => {
            replaceParticipants(result.participants);
            if (result.errors.length > 0) {
              print("err", `Imported ${result.participants.length} rows; ${result.errors.length} skipped (${result.errors[0]?.message})`);
            } else {
              print("hi", `✓ Imported ${result.participants.length} competitors from CSV.`);
            }
          }
        );
      } else {
        replaceParticipants(result.participants);
        if (result.errors.length > 0) {
          print("err", `Imported ${result.participants.length} rows; ${result.errors.length} skipped (${result.errors[0]?.message})`);
        } else {
          print("hi", `✓ Imported ${result.participants.length} competitors from CSV.`);
        }
      }
    };
    reader.readAsText(file);
    setPendingWizardKind(null);
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) { print("err", "No file selected."); return; }
    const adminTok = getLocalAdminToken();
    if (!adminTok) { print("err", "ERR: no admin token"); return; }
    try {
      print("dim", `Uploading ${file.name}…`);
      const r = await adminUploadLogo(adminTok, file) as { logo?: { filename: string; size: number } };
      if (r.logo) setLogoUrl(logoSrc() + "?t=" + Date.now());
      print("hi", `✓ Logo uploaded: ${r.logo?.filename ?? file.name}`);
    } catch (err2) {
      print("err", `ERR: ${(err2 as Error).message}`);
    }
    setPendingWizardKind(null);
  }

  // ─── render ──────────────────────────────────────────────────────────────

  const prompt = wizard
    ? wizard.kind === "confirm"
      ? "[yes/no] "
      : `[${wizard.kind} ${wizard.step + 1}/${wizard.prompts.length}] `
    : "> ";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2147483000,
        background: "#0a0a0a",
        display: "flex", flexDirection: "column",
        fontFamily: "'Courier New', Courier, monospace",
      }}
    >
      {/* scrollable output + inline input line */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 28px 20px",
          userSelect: "text",
          cursor: "text",
        }}
        onMouseUp={() => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed) inputRef.current?.focus();
        }}
      >
        {lines.map((l) => (
          <div
            key={l.id}
            style={{
              whiteSpace: "pre-wrap",
              lineHeight: 1.55,
              fontSize: 13,
              color:
                l.kind === "cmd" ? "#39ff14" :
                l.kind === "err" ? "#ff4444" :
                l.kind === "hi"  ? "#ccff66" :
                l.kind === "dim" ? "#3a8c3a" :
                "#22cc44",
            }}
          >
            {l.text}
          </div>
        ))}

        {/* inline current input line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            whiteSpace: "pre",
            lineHeight: 1.55,
            fontSize: 13,
            color: "#39ff14",
          }}
        >
          <span style={{ userSelect: "none" }}>{prompt}</span>
          <span>{input}</span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 13,
              background: "#39ff14",
              marginLeft: 1,
              verticalAlign: "text-bottom",
              animation: "blink 1s step-end infinite",
            }}
          />
        </div>
        <div ref={bottomRef} />
      </div>

      {/* hidden capture input — focusable, invisible */}
      <input
        ref={inputRef}
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
        style={{
          position: "absolute",
          left: -9999,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          padding: 0,
          border: 0,
          overflow: "hidden",
        }}
      />

      {/* hidden file inputs */}
      <input
        ref={csvRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={onCsvFile}
      />
      <input
        ref={logoRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        style={{ display: "none" }}
        onChange={onLogoFile}
      />

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  );
}
