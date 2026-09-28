/**
 * Was ein Token braucht, um in einer `recall_when`-Phrase als Inhaltswort zu
 * zählen — ohne Wortliste.
 *
 * Ursprünglich eine Stoppwortliste (en/de) für das harte Reflex-Matching, die
 * #360 mit der Zweierregel in `anchorStrength` (search.ts) teilte. Jede Sprache
 * ohne Liste behielt ihre Funktionswörter als Inhalt. Ersetzt durch zwei
 * sprachfreie Regeln (lexical.ts, common-terms.ts):
 *
 * - kurz (`isShortWord`, ≤ 3 Buchstaben): die häufigsten Wörter jeder Sprache
 *   sind ihre kürzesten — optional neben längeren Inhaltswörtern, nie verworfen;
 * - häufig im Vault (`isCommonShare`, ≥ 20 % der Dokumente ab 30 Dokumenten):
 *   Füllwort in der Sprache, in der dieser Nutzer schreibt.
 *
 * Unter {@link MIN_SIGNIFICANT_TOKEN_LEN} Buchstaben ist ein Token so oder so
 * kein Inhaltswort (Artikel, Kurzpräpositionen wie "an", "zu", "в").
 */

/** Mindestlänge in Buchstaben (`letterCount`), unter der ein Token kein
 *  Inhaltswort ist. Gleicher Wert wie `MIN_TOKEN_LEN` im Reflex-Pfad — ein
 *  Wort, keine zwei Zahlen. */
export const MIN_SIGNIFICANT_TOKEN_LEN = 3;

/**
 * #707: Wörter, die eine `recall_when`-Phrase in Alternativen teilen
 * („Nachricht oder Antwort entwerfen" → zwei Phrasen). Vorher ein festes
 * `oder|or` in `reflex.ts`. Daten pro Sprache; der sprachneutrale Teil ist
 * strukturell: ein freistehendes `/` oder `|` teilt in jeder Schrift. Eine
 * Sprache ohne Eintrag und ohne Trennzeichen fällt auf die normale Regel
 * zurück (alle Inhaltstokens müssen im Kontext stehen) — strenger, nie stumm
 * für die ganze Sprache.
 */
export const ALTERNATIVE_WORDS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  en: ["or"],
  de: ["oder"],
  ru: ["или"],
};

export const ALTERNATIVE_WORDS: ReadonlySet<string> = new Set(Object.values(ALTERNATIVE_WORDS_BY_LANGUAGE).flat());
