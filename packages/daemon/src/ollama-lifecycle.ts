/**
 * Energiebewusster Ollama-Modell-Lifecycle (#78).
 *
 * bastra-recall startet/stoppt NIE den Ollama-Prozess (das macht die Mac-App
 * bzw. der User) — gesteuert wird nur, ob das Embedding-Modell im RAM liegt:
 *
 *   - prewarm  = "Wakeup": Mini-Embed lädt das Modell, fire-and-forget beim
 *     Daemon-Boot, damit der erste echte Recall ein warmes Modell trifft.
 *     Seit #494 steht er NICHT mehr hier: Er lief als eigener HTTP-Call an
 *     der Singleflight-Grenze, am Breaker und am Nebenläufigkeitszähler
 *     vorbei, und war damit einer von bis zu fünf gleichzeitigen Embeds beim
 *     kalten Start. Es gibt jetzt genau einen Weg, dieses Modell zu wärmen —
 *     `WarmupCoordinator.ensureWarm` in `embedding-warmup.ts`.
 *   - unload   = "Idle-Befehl": keep_alive:0 entlädt das Modell sofort —
 *     ~600 MB RAM frei statt Dauerbelegung (mobiler Akku). Der nächste
 *     Embed lädt es in 1–2 s zurück.
 *
 * Bewusst KEIN OLLAMA_KEEP_ALIVE=-1 (Hebel B aus #78): das hielte das Modell
 * für immer im RAM — genau das Gegenteil des Energie-Ziels.
 * Alle Calls best-effort: werfen nie, loggen nur.
 */

/**
 * Ist `model` gerade resident? Best-effort — ein Fehler heißt "unbekannt",
 * nicht "nein", damit ein /api/ps-Ausfall den Unload nicht fälschlich
 * auf "war eh nicht geladen" umbiegt.
 */
async function isModelResident(base: string, model: string): Promise<boolean | null> {
  try {
    const resp = await fetchGetWithTimeout(`${base}/api/ps`, 5_000);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { models?: { model?: string; name?: string }[] };
    return (data.models ?? []).some((m) => m.model === model || m.name === model);
  } catch {
    return null;
  }
}

/** Modell sofort entladen (Idle). true = unload akzeptiert (auch: war schon nicht resident). */
export async function unloadOllamaModel(baseURL: string, model: string): Promise<boolean> {
  const base = baseURL.replace(/\/+$/, "");
  // #L01: nicht resident → nichts zu entladen. Ohne diese Prüfung lädt der
  // Unload-Request selbst ein kaltes Modell (14–16 s), weil /api/embed mit
  // leerem Input trotzdem eine echte Inferenz ist und das Modell dafür erst
  // lädt — der Idle-Befehl kehrt den Energie-Zweck dann um.
  const resident = await isModelResident(base, model);
  if (resident === false) {
    console.error(`[bastra-recall] ollama idle-unload: ${model} was not resident — nothing to do`);
    return true;
  }
  try {
    // /api/generate ohne `prompt` ist der dokumentierte reine Unload-Weg:
    // keep_alive:0 ohne Prompt entlädt, ohne eine Inferenz anzustoßen.
    // /api/embed mit leerem Input tut das NICHT — der leere Input ist
    // trotzdem ein echter Embed-Aufruf und lädt ein kaltes Modell erst.
    const resp = await fetchWithTimeout(`${base}/api/generate`, { model, keep_alive: 0 }, 10_000);
    if (resp.ok) {
      console.error(`[bastra-recall] ollama idle-unload: ${model} released (~RAM freed; next embed reloads it)`);
      return true;
    }
    console.error(`[bastra-recall] ollama idle-unload failed: HTTP ${resp.status}`);
    return false;
  } catch (err) {
    console.error(`[bastra-recall] ollama idle-unload failed: ${(err as Error).message}`);
    return false;
  }
}

async function fetchGetWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function fetchWithTimeout(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(tid);
  }
}
