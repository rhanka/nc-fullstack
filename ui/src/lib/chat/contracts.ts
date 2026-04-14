import type {
  AiComplexitySelection,
  AiModelSelection,
  AiSourceGroup,
  AiSourceGroups,
  AiSourceItem,
} from "../../../../shared/ai-source-v1";

export type ChatTaskRole = "000" | "100" | "200" | "300" | "400" | "500" | string;

export type ChatSubmitArgs = {
  text?: string;
  role?: ChatTaskRole;
};

export type ChatController = {
  clearMessages: () => void;
  submitUserMessage: (args?: ChatSubmitArgs) => Promise<void>;
  setDraftInput: (text?: string) => void;
};

export type ReferenceSourceItem = AiSourceItem;
export type ReferenceSourceGroup = AiSourceGroup;
export type ReferenceSources = AiSourceGroups;

export type ChatModelSelection = AiModelSelection;
export type ChatComplexitySelection = AiComplexitySelection;
