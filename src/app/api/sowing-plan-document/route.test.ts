import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { createSupabaseSowingPlanDocumentRepository, MAX_SOWING_PLAN_DOCUMENT_BYTES } from "@/lib/repositories/supabase-sowing-plan-document-repository";
import { GET, POST } from "./route";

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

const document = {
  id: "11111111-1111-4111-8111-111111111111",
  contentType: "image/jpeg" as const,
  fileSizeBytes: 4,
  isCurrent: true,
  originalFileName: "plan.jpg",
  storageBucket: "small-plants-plan-documents",
  storagePath: "current/plan.jpg",
};

describe("sowing plan document API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasValidSession).mockResolvedValue(true);
    vi.mocked(isSupabaseServerConfigured).mockReturnValue(true);
  });

  it("requires an authenticated Small Plants session", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await GET(new NextRequest("http://localhost/api/sowing-plan-document"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns null when there is no current document", async () => {
    vi.mocked(createSupabaseSowingPlanDocumentRepository).mockReturnValue({
      downloadCurrent: vi.fn(),
      loadCurrent: vi.fn().mockResolvedValue(null),
      saveCurrent: vi.fn(),
    });

    const response = await GET(new NextRequest("http://localhost/api/sowing-plan-document"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ document: null });
  });

  it.each([
    ["image/jpeg", "plan.jpg"],
    ["image/png", "plan.png"],
    ["application/pdf", "plan.pdf"],
  ])("uploads %s files", async (contentType, fileName) => {
    const saveCurrent = vi.fn().mockResolvedValue({ ...document, contentType, originalFileName: fileName });
    vi.mocked(createSupabaseSowingPlanDocumentRepository).mockReturnValue({
      downloadCurrent: vi.fn(),
      loadCurrent: vi.fn(),
      saveCurrent,
    });

    const response = await POST(uploadRequest(new File(["demo"], fileName, { type: contentType })));

    expect(response.status).toBe(200);
    expect(saveCurrent).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ document: { originalFileName: fileName } });
  });

  it("rejects unsupported MIME types", async () => {
    const response = await POST(uploadRequest(new File(["demo"], "plan.txt", { type: "text/plain" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Atļauti tikai JPEG, PNG vai PDF faili." });
  });

  it("rejects files over 10 MB", async () => {
    const file = new File([new Uint8Array(MAX_SOWING_PLAN_DOCUMENT_BYTES + 1)], "plan.pdf", { type: "application/pdf" });

    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Fails ir par lielu. Maksimums ir 10 MB." });
  });
});

function uploadRequest(file: File): NextRequest {
  const formData = new FormData();
  formData.append("file", file);

  return new NextRequest("http://localhost/api/sowing-plan-document", {
    body: formData,
    method: "POST",
  });
}
