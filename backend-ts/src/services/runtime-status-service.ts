import {
  listExecutionProfiles,
  type ExecutionProfileDefinition,
} from "./execution-profile-registry.ts";
import { getRuntimeContractSummary } from "../contracts/ai.ts";
import { getLlmRuntimeSummary } from "../llm/index.ts";
import { getRetrievalRuntimeSummary } from "../retrieval/index.ts";

const LAYERS = ["contracts", "retrieval", "llm", "services", "routes"] as const;

export interface RuntimeStatus {
  readonly status: "ok";
  readonly service: "nc-backend-ts";
  readonly tsFoundation: true;
  readonly timestamp: string;
  readonly layers: readonly string[];
  readonly profiles: readonly ExecutionProfileDefinition[];
  readonly contracts: ReturnType<typeof getRuntimeContractSummary>;
  readonly retrieval: ReturnType<typeof getRetrievalRuntimeSummary>;
  readonly llm: ReturnType<typeof getLlmRuntimeSummary>;
}

export function getRuntimeStatus(now: Date = new Date()): RuntimeStatus {
  return {
    status: "ok",
    service: "nc-backend-ts",
    tsFoundation: true,
    timestamp: now.toISOString(),
    layers: LAYERS,
    profiles: listExecutionProfiles(),
    contracts: getRuntimeContractSummary(),
    retrieval: getRetrievalRuntimeSummary(),
    llm: getLlmRuntimeSummary(),
  };
}
