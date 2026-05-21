import type { BeltColor, Participant } from "./types";
import { BELT_ALIASES } from "./data";

export interface CsvParseError {
  line: number;
  message: string;
}
export interface CsvParseResult {
  participants: Omit<Participant, "id">[];
  errors: CsvParseError[];
}

const REQUIRED = ["nombre", "apellido", "beltColor", "age"] as const;

/**
 * Parse a CSV with header row: nombre,apellido,beltColor,age.
 * Lenient: trims whitespace, accepts Spanish belt aliases, skips empty lines.
 */
export function parseParticipantsCsv(text: string): CsvParseResult {
  const out: Omit<Participant, "id">[] = [];
  const errors: CsvParseError[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { participants: out, errors };

  const headerLine = lines[0]?.trim() ?? "";
  const header = splitLine(headerLine).map((h) => h.toLowerCase());
  const idx = {
    nombre: header.indexOf("nombre"),
    apellido: header.indexOf("apellido"),
    beltColor: header.indexOf("beltcolor"),
    age: header.indexOf("age"),
  };
  for (const k of REQUIRED) {
    const got = idx[k as keyof typeof idx];
    if (got < 0) {
      errors.push({ line: 1, message: `Missing required column: ${k}` });
    }
  }
  if (errors.length > 0) return { participants: out, errors };

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = splitLine(raw);
    const nombre = (cols[idx.nombre] ?? "").trim();
    const apellido = (cols[idx.apellido] ?? "").trim();
    const beltRaw = (cols[idx.beltColor] ?? "").trim().toLowerCase();
    const ageRaw = (cols[idx.age] ?? "").trim();

    if (!nombre || !apellido) {
      errors.push({ line: i + 1, message: "nombre and apellido are required" });
      continue;
    }
    const belt = BELT_ALIASES[beltRaw];
    if (!belt) {
      errors.push({
        line: i + 1,
        message: `Unknown beltColor: "${beltRaw}"`,
      });
      continue;
    }
    const age = Number.parseInt(ageRaw, 10);
    if (!Number.isFinite(age) || age < 3 || age > 99) {
      errors.push({
        line: i + 1,
        message: `Invalid age: "${ageRaw}"`,
      });
      continue;
    }
    // Default `arrived: false` on CSV import so the operator must visit
    // the Check-in tab to mark who actually showed up on tournament day.
    out.push({ nombre, apellido, beltColor: belt, age, arrived: false });
  }
  return { participants: out, errors };
}

function splitLine(line: string): string[] {
  // Minimal CSV: comma-separated, optional double-quoted fields with escaped quotes.
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { out.push(cur); cur = ""; i++; continue; }
    cur += c; i++;
  }
  out.push(cur);
  return out;
}

export function stringifyParticipantsCsv(
  participants: Pick<Participant, "nombre" | "apellido" | "beltColor" | "age">[]
): string {
  const lines = ["nombre,apellido,beltColor,age"];
  for (const p of participants) {
    lines.push(
      [p.nombre, p.apellido, p.beltColor, p.age].map(csvField).join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function csvField(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function newParticipantId(): string {
  return "p_" + Math.random().toString(36).slice(2, 10);
}
