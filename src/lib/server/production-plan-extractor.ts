import "server-only";
import {
  buildProductionPlanImportResult,
  type ExtractedProductionPlan,
  type ExtractedProductionPlanRow,
  unconfiguredProductionPlanImportResult,
} from "@/lib/production-plan-import";
import type { PlanImportResult } from "@/lib/types";

export async function extractProductionPlan(image: File): Promise<PlanImportResult> {
  if (!isProductionPlanExtractorConfigured()) {
    return unconfiguredProductionPlanImportResult(image.name, configuredProviderName());
  }

  const extracted = await callConfiguredExtractor(image);
  return buildProductionPlanImportResult(extracted);
}

export function isProductionPlanExtractorConfigured(): boolean {
  return configuredProviderName() === "mock-fixture";
}

function configuredProviderName(): string {
  return process.env.PRODUCTION_PLAN_EXTRACTOR_PROVIDER ?? "not-configured";
}

async function callConfiguredExtractor(image: File): Promise<ExtractedProductionPlan> {
  if (configuredProviderName() === "mock-fixture") {
    return mockFixtureExtraction(image);
  }

  throw new Error("Production plan extractor provider is not configured.");
}

async function mockFixtureExtraction(image: File): Promise<ExtractedProductionPlan> {
  const fixtureRows: ExtractedProductionPlanRow[] = [
    {
      id: "fixture-hus-6",
      hus: "Hus 6",
      variety: "Baltazsara",
      weekNumber: 40,
      moveOutDate: "21.10.2026",
      sowingDate: "29.09.2026",
      sowingCount: 3556,
      confidence: {
        hus: 0.98,
        moveOutDate: 0.96,
        sowingCount: 0.94,
        sowingDate: 0.96,
      },
    },
  ];

  return {
    provider: "mock-fixture",
    fileName: image.name,
    extractedAt: new Date().toISOString(),
    rows: fixtureRows,
  };
}
