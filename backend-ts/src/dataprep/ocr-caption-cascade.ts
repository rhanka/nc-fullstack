import {
  normalizeImageCaptionAnalysis,
  type ImageCaptionAnalysis,
  type ImageCaptionClient,
  type ImageCaptionClientInput,
} from "./ocr-tech-docs.ts";
import {
  OpenAIImageCaptionV2Client,
  routeImageCaptionV2,
  type ImageCaptionRoute,
  type ImageCaptionRoutingDecision,
  type ImageCaptionV2,
  type ImageCaptionV2Client,
} from "./ocr-caption-routing-calibration.ts";

export type OcrCaptionCascadeTrigger =
  | "nano_route"
  | "routing_deep_pass"
  | "technical_retry"
  | "deep_pass_failed_fallback_to_nano";

export interface OcrCaptionCascadeAudit {
  readonly doc: string;
  readonly primaryModel: string;
  readonly deepModel: string;
  readonly selectedModel: string;
  readonly route: ImageCaptionRoute;
  readonly trigger: OcrCaptionCascadeTrigger;
  readonly routeReasons: readonly string[];
  readonly primaryError?: string;
  readonly deepError?: string;
  readonly generatedAt: string;
}

export type ImageCaptionV2ClientFactory = (model: string) => ImageCaptionV2Client;

export interface OcrCaptionCascadeClientOptions {
  readonly primaryModel?: string;
  readonly deepModel?: string;
  readonly clientFactory?: ImageCaptionV2ClientFactory;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultClientFactory(model: string): ImageCaptionV2Client {
  return new OpenAIImageCaptionV2Client({
    model,
    imageDetail: process.env.IMAGE_CAPTION_DETAIL ?? process.env.OCR_ROUTING_CALIBRATION_IMAGE_DETAIL,
  });
}

function toV1Analysis(caption: ImageCaptionV2): ImageCaptionAnalysis {
  return normalizeImageCaptionAnalysis(caption);
}

export class OcrCaptionCascadeClient implements ImageCaptionClient {
  readonly provider = "openai-cascade";
  readonly model: string;
  readonly primaryModel: string;
  readonly deepModel: string;
  readonly #primary: ImageCaptionV2Client;
  readonly #deep: ImageCaptionV2Client;
  #lastAudit: OcrCaptionCascadeAudit | null = null;

  constructor(options: OcrCaptionCascadeClientOptions = {}) {
    this.primaryModel = options.primaryModel ?? process.env.IMAGE_CAPTION_PRIMARY_MODEL ?? "gpt-5.4-nano";
    this.deepModel = options.deepModel ?? process.env.IMAGE_CAPTION_DEEP_MODEL ?? "gpt-5.4";
    this.model = this.primaryModel + "->" + this.deepModel;
    const factory = options.clientFactory ?? defaultClientFactory;
    this.#primary = factory(this.primaryModel);
    this.#deep = factory(this.deepModel);
  }

  getLastAudit(): OcrCaptionCascadeAudit | null {
    return this.#lastAudit;
  }

  async analyzePage(input: ImageCaptionClientInput): Promise<ImageCaptionAnalysis> {
    this.#lastAudit = null;
    let primaryCaption: ImageCaptionV2;
    let decision: ImageCaptionRoutingDecision;
    try {
      primaryCaption = await this.#primary.analyzePage(input);
      decision = routeImageCaptionV2(primaryCaption);
    } catch (error) {
      const primaryError = errorMessage(error);
      const deepCaption = await this.#deep.analyzePage(input);
      this.#lastAudit = {
        doc: input.doc,
        primaryModel: this.primaryModel,
        deepModel: this.deepModel,
        selectedModel: this.deepModel,
        route: "gpt-5.4",
        trigger: "technical_retry",
        routeReasons: ["primary technical failure"],
        primaryError,
        generatedAt: new Date().toISOString(),
      };
      return toV1Analysis(deepCaption);
    }

    if (decision.route === "nano") {
      this.#lastAudit = {
        doc: input.doc,
        primaryModel: this.primaryModel,
        deepModel: this.deepModel,
        selectedModel: this.primaryModel,
        route: decision.route,
        trigger: "nano_route",
        routeReasons: decision.reasons,
        generatedAt: new Date().toISOString(),
      };
      return toV1Analysis(primaryCaption);
    }

    try {
      const deepCaption = await this.#deep.analyzePage(input);
      this.#lastAudit = {
        doc: input.doc,
        primaryModel: this.primaryModel,
        deepModel: this.deepModel,
        selectedModel: this.deepModel,
        route: decision.route,
        trigger: "routing_deep_pass",
        routeReasons: decision.reasons,
        generatedAt: new Date().toISOString(),
      };
      return toV1Analysis(deepCaption);
    } catch (error) {
      this.#lastAudit = {
        doc: input.doc,
        primaryModel: this.primaryModel,
        deepModel: this.deepModel,
        selectedModel: this.primaryModel,
        route: decision.route,
        trigger: "deep_pass_failed_fallback_to_nano",
        routeReasons: decision.reasons,
        deepError: errorMessage(error),
        generatedAt: new Date().toISOString(),
      };
      return toV1Analysis(primaryCaption);
    }
  }
}

export function createCascadeImageCaptionClientFromEnv(): ImageCaptionClient {
  return new OcrCaptionCascadeClient({
    primaryModel: process.env.IMAGE_CAPTION_PRIMARY_MODEL ?? process.env.IMAGE_CAPTION_MODEL ?? "gpt-5.4-nano",
    deepModel: process.env.IMAGE_CAPTION_DEEP_MODEL ?? process.env.IMAGE_CAPTION_FALLBACK_MODEL ?? "gpt-5.4",
  });
}
