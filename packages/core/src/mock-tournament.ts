import type { CategoryDef, Participant } from "./types";
import { defaultCategoryDefs } from "./category-defs";
import { newParticipantId } from "./csv";

const FIRST_NAMES_M = [
  "Alejandro", "Mateo", "Diego", "Santiago", "Andrés", "Luis", "Sebastián",
  "Gabriel", "Tomás", "Joaquín", "Daniel", "Hugo", "Iván", "Bruno", "Emilio",
  "Felipe", "Adrián", "Marcos", "Nicolás", "Roberto", "Pablo", "Carlos",
  "Manuel", "Fernando", "Javier", "Eduardo", "Leonardo", "Esteban",
];
const FIRST_NAMES_F = [
  "Sofía", "Valentina", "Camila", "Lucía", "Mariana", "Daniela", "Isabella",
  "Renata", "Emilia", "Paula", "Andrea", "Carolina", "Natalia", "Gabriela",
  "Adriana", "Patricia", "Beatriz", "Lorena", "Cristina", "Elena", "Marina",
  "Alicia", "Rosa", "Pilar", "Inés", "Clara", "Julia",
];
const SURNAMES = [
  "García", "Rodríguez", "Martínez", "Hernández", "López", "González",
  "Pérez", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez",
  "Díaz", "Cruz", "Morales", "Reyes", "Gutiérrez", "Ortiz", "Chávez",
  "Ramos", "Mendoza", "Vargas", "Castillo", "Jiménez", "Romero", "Álvarez",
  "Moreno", "Muñoz", "Aguilar", "Vega", "Navarro", "Silva", "Soto", "Peña",
  "Cortés", "Luna", "Cabrera", "Ríos", "Salazar", "Cárdenas", "Valdez",
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

function buildCohort(
  beltKey: NonNullable<Participant["beltColor"]>,
  ageMin: number,
  ageMax: number,
  count: number,
  startSeed: number
): Participant[] {
  const out: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const seed = startSeed + i;
    const female = i % 2 === 0;
    const first = pick(female ? FIRST_NAMES_F : FIRST_NAMES_M, seed * 7);
    const sa = pick(SURNAMES, seed * 11 + 3);
    const sb = pick(SURNAMES, seed * 13 + 19);
    const age = ageMax === ageMin
      ? ageMin
      : ageMin + ((seed * 17) % (ageMax - ageMin + 1));
    out.push({
      id: newParticipantId(),
      nombre: first,
      apellido: `${sa} ${sb}`,
      beltColor: beltKey,
      age,
    });
  }
  return out;
}

/**
 * Generate a full mock tournament: the four spec-defined categories,
 * each with 42–48 distinct competitors using realistic Spanish names.
 */
export function generateMockTournament(): {
  categoryDefs: CategoryDef[];
  participants: Participant[];
} {
  const defs = defaultCategoryDefs();
  const participants: Participant[] = [
    ...buildCohort("yellow", 4, 6, 45, 100),
    ...buildCohort("brown", 10, 12, 47, 200),
    ...buildCohort("black", 13, 15, 43, 300),
    ...buildCohort("black", 16, 35, 48, 400), // Adult Open — primarily black belts in this mock
  ];
  return { categoryDefs: defs, participants };
}
