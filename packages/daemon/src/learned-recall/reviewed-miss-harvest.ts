import {
  hash,
  humanIntent,
  isEvidenceRead,
  isRecall,
  matchingResults,
  readEnvelope,
  resultText,
  sourceRef,
  toolUses,
  type Envelope,
  type ToolUse,
} from "./reviewed-miss-shared.js";

export { hash };

/**
 * The chain a raw session proves on its own: human intent, the exact Recall
 * call, its result envelope, and the first evidence step after that result.
 * Nothing here is classified; the offline engines attach the frozen pool and
 * the vault proofs, and the classifier decides. Raw identifiers stay inside
 * this process — the queue record only ever carries their hashes.
 */
export interface ReviewedMissChain {
  query: string;
  sessionIdentity: string;
  /** `recall_id` from the served envelope, when the envelope carried one. */
  recallId: string | null;
  /** Envelope-level miss signal: `weak_result`, `no_home` or an empty `hits`. */
  explicitMiss: boolean;
  /** Ids the served envelope listed under `hits`, in served order. */
  servedIds: string[];
  /** Transcript timestamp of the matching tool_result, if the record had one. */
  resultTs: string | null;
  evidence: ReviewedMissEvidence;
}

export type ReviewedMissEvidence =
  | { kind: "load-memory"; memoryId: string }
  | { kind: "file-read"; path: string }
  | { kind: "opaque"; sourceRef: string | null };

export interface ReviewedMissCandidate {
  kind: "reviewed-recall-miss-candidate/v1";
  status: "needs-relevance-label" | "candidate";
  query: string;
  sessionRef: string;
  sourceRef: string | null;
  evidence: {
    recall: "explicit-miss" | "nonempty-or-unclassified";
    sourceReadAfterRecall: true;
  };
}

function isLoadMemory(tool: ToolUse): boolean {
  return typeof tool.name === "string" && /(?:^|__)load_memory$/i.test(tool.name);
}

function evidenceOf(tool: ToolUse): ReviewedMissEvidence {
  const input = (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<string, unknown>;
  if (isLoadMemory(tool) && typeof input.id === "string" && input.id) return { kind: "load-memory", memoryId: input.id };
  if (typeof tool.name === "string" && /^Read$/i.test(tool.name) && typeof input.file_path === "string" && input.file_path) {
    return { kind: "file-read", path: input.file_path };
  }
  return { kind: "opaque", sourceRef: sourceRef(tool) };
}

/**
 * Extract the intent → Recall → result → evidence chains a raw Claude JSONL
 * session proves. Results join their Recall call by tool_use_id, never by
 * adjacency. The chain keeps raw ids for the engines; `toCandidate` is the
 * only shape that leaves the process.
 */
export interface RecallCallStats {
  /** Recall calls whose result arrived. */
  recalls: number;
  /** Of those, results whose envelope carried a `recall_id`. */
  withRecallId: number;
}

export function extractReviewedMissChains(jsonl: string, sessionIdentity: string, stats?: RecallCallStats): ReviewedMissChain[] {
  const chains: ReviewedMissChain[] = [];
  let intent: string | null = null;
  let pending: {
    query: string;
    envelope: Envelope;
    resultSeen: boolean;
    resultTs: string | null;
    toolIds: Set<string>;
  } | null = null;
  let evidence: ReviewedMissEvidence | null = null;

  const emit = (): void => {
    if (!pending || evidence === null) return;
    chains.push({
      query: pending.query,
      sessionIdentity,
      recallId: pending.envelope.recallId,
      explicitMiss: pending.envelope.explicitMiss,
      servedIds: pending.envelope.servedIds,
      resultTs: pending.resultTs,
      evidence,
    });
  };

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record.type === "user") {
      const intentText = humanIntent(record);
      if (intentText) {
        emit();
        intent = intentText;
        pending = null;
        evidence = null;
      }
      if (pending) {
        for (const part of matchingResults(record, pending.toolIds)) {
          if (!pending.resultSeen && stats) stats.recalls += 1;
          pending.resultSeen = true;
          pending.resultTs = typeof record.timestamp === "string" ? record.timestamp : pending.resultTs;
          const envelope = readEnvelope(resultText(part));
          if (stats && envelope.recallId && !pending.envelope.recallId) stats.withRecallId += 1;
          pending.envelope = {
            explicitMiss: pending.envelope.explicitMiss || envelope.explicitMiss,
            recallId: pending.envelope.recallId ?? envelope.recallId,
            servedIds: pending.envelope.servedIds.length > 0 ? pending.envelope.servedIds : envelope.servedIds,
          };
        }
      }
    }
    if (record.type !== "assistant") continue;
    for (const tool of toolUses(record)) {
      if (isRecall(tool) && intent) {
        pending = {
          query: intent,
          envelope: { explicitMiss: false, recallId: null, servedIds: [] },
          resultSeen: false,
          resultTs: null,
          toolIds: new Set(typeof tool.id === "string" ? [tool.id] : []),
        };
        evidence = null;
      } else if (pending?.resultSeen && (isEvidenceRead(tool) || isLoadMemory(tool)) && evidence === null) {
        evidence = evidenceOf(tool);
      }
    }
  }
  emit();
  return chains;
}

/** The pathless v1 queue record: hashed identities, verbatim query, no payload. */
export function toCandidate(chain: ReviewedMissChain): ReviewedMissCandidate {
  const ref = chain.evidence.kind === "load-memory"
    ? hash("id:" + chain.evidence.memoryId)
    : chain.evidence.kind === "file-read"
      ? hash("file_path:" + chain.evidence.path)
      : chain.evidence.sourceRef;
  return {
    kind: "reviewed-recall-miss-candidate/v1",
    status: chain.explicitMiss ? "candidate" : "needs-relevance-label",
    query: chain.query,
    sessionRef: hash(chain.sessionIdentity),
    sourceRef: ref,
    evidence: {
      recall: chain.explicitMiss ? "explicit-miss" : "nonempty-or-unclassified",
      sourceReadAfterRecall: true,
    },
  };
}

/**
 * Extract review candidates from a raw Claude JSONL session without retaining
 * paths, payloads, or tool output. A later source read does not prove a
 * nonempty Recall irrelevant, so only an envelope-level miss is a candidate.
 */
export function harvestReviewedMisses(jsonl: string, sessionIdentity: string): ReviewedMissCandidate[] {
  return extractReviewedMissChains(jsonl, sessionIdentity).map(toCandidate);
}
