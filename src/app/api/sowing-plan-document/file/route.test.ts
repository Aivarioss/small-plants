import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { createSupabaseSowingPlanDocumentRepository } from "@/lib/repositories/supabase-sowing-plan-document-repository";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  hasValidSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseServerConfigured: vi.fn(),
}));

vi.mock("@/lib/repositories/supabase-sowing-plan-document-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/supabase-sowing-plan-document-repository")>();
  return {
    ...actual,
    createSupabaseSowingPlanDocumentRepository: vi.fn(),
  };
});

describe("sowing plan document file API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasValidSession).mockResolvedValue(true);
    vi.mocked(isSupabaseServerConfigured).mockReturnValue(true);
  });

  it("requires an authenticated Small Plants session", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await GET(new NextRequest("http://localhost/api/sowing-plan-document/file"));

    expect(response.status).toBe(401);
  });

  it("returns the current private storage file inline", async () => {
    vi.mocked(createSupabaseSowingPlanDocumentRepository).mockReturnValue({
      downloadCurrent: vi.fn().mockResolvedValue({
        document: {
          id: "11111111-1111-4111-8111-111111111111",
          contentType: "application/pdf",
          fileSizeBytes: 3,
          isCurrent: true,
          originalFileName: "plāns.pdf",
          storageBucket: "small-plants-plan-documents",
          storagePath: "current/plan.pdf",
        },
        file: new Blob(["pdf"], { type: "application/pdf" }),
      }),
      loadCurrent: vi.fn(),
      saveCurrent: vi.fn(),
    });

    const response = await GET(new NextRequest("http://localhost/api/sowing-plan-document/file"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    await expect(response.text()).resolves.toBe("pdf");
  });

  it("returns 404 when no current file exists", async () => {
    vi.mocked(createSupabaseSowingPlanDocumentRepository).mockReturnValue({
      downloadCurrent: vi.fn().mockResolvedValue(null),
      loadCurrent: vi.fn(),
      saveCurrent: vi.fn(),
    });

    const response = await GET(new NextRequest("http://localhost/api/sowing-plan-document/file"));

    expect(response.status).toBe(404);
  });
});
