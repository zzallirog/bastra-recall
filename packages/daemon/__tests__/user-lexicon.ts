/**
 * The cue words bastra shipped until the stop lane went language-neutral
 * (de/en/ru, lexicon.ts) — now what a user may keep as their OWN lexicon file.
 *
 * Tests of the cue-word path install them this way: the path still works
 * exactly as before for whoever writes cues, and nothing about it is shipped.
 * Not a test file (no `.test.ts`), so the runner does not execute it.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const USER_FRUSTRATION_CUES: readonly string[] = [
  "schon\\s+wieder", "wieder", "wie\\s+oft", "verdammt", "schei(?:ss|ß)e",
  "yet\\s+again", "again", "how\\s+(?:often|many\\s+times)", "damn", "fuck", "shit",
  "снова", "опять", "сколько\\s+раз", "ч[её]рт", "бл(?:ин|ять)",
];

export const USER_DECISION_CUES: readonly string[] = [
  "ok\\s+dann", "lass\\s+uns", "entschieden", "gehen\\s+wir\\s+mit",
  "ok(?:ay)?\\s+then", "let['’]?s\\s+(?:go\\s+with|use)", "we['’]ll\\s+go\\s+with", "we\\s+will\\s+go\\s+with",
  "decided", "settled\\s+on",
  "решено", "остановимся\\s+на", "договорились",
  "final",
];

/** Point BASTRA_LEXICON_DIR at a fresh dir holding the lists above. */
export function installUserLexicon(): string {
  const dir = mkdtempSync(join(tmpdir(), "bastra-user-lexicon-"));
  writeFileSync(join(dir, "frustration.txt"), USER_FRUSTRATION_CUES.join("\n") + "\n", "utf8");
  writeFileSync(join(dir, "decision.txt"), USER_DECISION_CUES.join("\n") + "\n", "utf8");
  process.env.BASTRA_LEXICON_DIR = dir;
  return dir;
}
