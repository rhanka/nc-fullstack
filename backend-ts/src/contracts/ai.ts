export const CONTRACT_VERSIONS = ["ai/source-v1", "ai/v2"] as const;
export const PLANNED_EXECUTION_PROFILES = [
  "search_rewrite",
  "draft_simple",
  "draft_standard_000",
  "analysis_standard_100",
  "analysis_deep",
] as const;

export type ContractVersion = (typeof CONTRACT_VERSIONS)[number];
export type ExecutionProfile = (typeof PLANNED_EXECUTION_PROFILES)[number];

export interface RuntimeContractSummary {
  readonly versions: readonly ContractVersion[];
  readonly sourceVersion: "ai/source-v1";
  readonly targetVersion: "ai/v2";
  readonly plannedProfiles: readonly ExecutionProfile[];
}

export function getRuntimeContractSummary(): RuntimeContractSummary {
  return {
    versions: CONTRACT_VERSIONS,
    sourceVersion: "ai/source-v1",
    targetVersion: "ai/v2",
    plannedProfiles: PLANNED_EXECUTION_PROFILES,
  };
}
