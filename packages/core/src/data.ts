import type { AgeRange, BeltColor, CommandKey } from "./types";

export const BELT_ORDER: BeltColor[] = [
  "white",
  "yellow",
  "orange",
  "green",
  "blue",
  "purple",
  "brown",
  "black",
];

export const BELT_LABEL_EN: Record<BeltColor, string> = {
  white: "White",
  yellow: "Yellow",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  brown: "Brown",
  black: "Black",
};

/** Accept Spanish belt names too. */
export const BELT_ALIASES: Record<string, BeltColor> = {
  white: "white", blanco: "white", blanca: "white",
  yellow: "yellow", amarillo: "yellow", amarilla: "yellow",
  orange: "orange", naranja: "orange",
  green: "green", verde: "green",
  blue: "blue", azul: "blue",
  purple: "purple", morado: "purple", morada: "purple", violeta: "purple",
  brown: "brown", marron: "brown", "marrón": "brown", cafe: "brown", "café": "brown",
  black: "black", negro: "black", negra: "black",
};

export const AGE_RANGES: AgeRange[] = [
  "4-6",
  "7-9",
  "10-12",
  "13-15",
  "16-17",
  "adult",
];

export const AGE_RANGE_LABEL: Record<AgeRange, string> = {
  "4-6": "4-6",
  "7-9": "7-9",
  "10-12": "10-12",
  "13-15": "13-15",
  "16-17": "16-17",
  adult: "Adult",
};

export const DEFAULT_KEYS: Record<CommandKey, string> = {
  selectRed: "r",
  selectBlue: "a",
  add1: "1",
  add2: "2",
  add3: "3",
  senshu: "s",
  penalty: "c",
  undo: "Delete",
  pauseTimer: " ",
  addSecond: "+",
  subSecond: "-",
};

export const KEY_LABELS: Record<CommandKey, string> = {
  selectRed: "Select Red competitor",
  selectBlue: "Select Blue competitor",
  add1: "Add 1 point",
  add2: "Add 2 points",
  add3: "Add 3 points",
  senshu: "Toggle advantage (Senshu)",
  penalty: "Add penalty",
  undo: "Undo modifier",
  pauseTimer: "Pause / Resume timer",
  addSecond: "Add 1 second",
  subSecond: "Subtract 1 second",
};

export const KATA_DISABLED_COMMANDS = new Set<CommandKey>([
  "senshu",
  "penalty",
  "pauseTimer",
  "addSecond",
  "subSecond",
]);
