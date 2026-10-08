import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createSupabaseSowingPlanDocumentRepository,
  MAX_SOWING_PLAN_DOCUMENT_BYTES,
  validateSowingPlanDocumentFile,
} from "./supabase-sowing-plan-document-repository";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const oldRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  storage_bucket: "small-plants-plan-documents",
  storage_path: "current/old.pdf",
  original_file_name: "old.pdf",
  content_type: "application/pdf",
  file_size_bytes: 1200,
  is_current: true,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

describe("supabase sowing plan document repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no current document", async () => {
    const client = {
      from: vi.fn().mockReturnValueOnce(selectCurrentResult(null)),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(createSupabaseSowingPlanDocumentRepository().loadCurrent()).resolves.toBeNull();
  });

  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["plan.pdf", "application/pdf"],
  ])("accepts %s upload", (_name, contentType) => {
    expect(() => validateSowingPlanDocumentFile(new File(["demo"], _name, { type: contentType }))).not.toThrow();
  });

  it("rejects unsupported MIME types", () => {
    expect(() => validateSowingPlanDocumentFile(new File(["demo"], "plan.txt", { type: "text/plain" }))).toThrow(
      "Atļauti tikai JPEG, PNG vai PDF faili.",
    );
  });

  it("rejects files over 10 MB", () => {
    const file = new File([new Uint8Array(MAX_SOWING_PLAN_DOCUMENT_BYTES + 1)], "plan.pdf", { type: "application/pdf" });

    expect(() => validateSowingPlanDocumentFile(file)).toThrow("Fails ir par lielu. Maksimums ir 10 MB.");
  });

  it("replaces the current document without deleting old storage", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = {
      storage: {
        from: vi.fn().mockReturnValue({ remove, upload }),
      },
      from: vi
        .fn()
        .mockReturnValueOnce(selectCurrentResult(oldRecord))
        .mockReturnValueOnce(insertResult())
        .mockReturnValueOnce(updateEqResult())
        .mockReturnValueOnce(updateSelectSingleResult({
          ...oldRecord,
          id: "22222222-2222-4222-8222-222222222222",
          original_file_name: "new.png",
          content_type: "image/png",
          file_size_bytes: 4,
          storage_path: "current/new.png",
          is_current: true,
        })),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const document = await createSupabaseSowingPlanDocumentRepository().saveCurrent(
      new File(["demo"], "new.png", { type: "image/png" }),
    );

    expect(document.originalFileName).toBe("new.png");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(4);
  });

  it("cleans up new storage object when metadata insert fails", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = {
      storage: {
        from: vi.fn().mockReturnValue({ remove, upload }),
      },
      from: vi
        .fn()
        .mockReturnValueOnce(selectCurrentResult(oldRecord))
        .mockReturnValueOnce(insertResult({ message: "insert failed" }))
        .mockReturnValueOnce(deleteResult()),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(
      createSupabaseSowingPlanDocumentRepository().saveCurrent(new File(["demo"], "new.pdf", { type: "application/pdf" })),
    ).rejects.toThrow("Neizdevās saglabāt sēšanas plāna metadatus");

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0][0]).toMatch(/^current\/\d{4}-\d{2}-\d{2}-/);
  });

  it("downloads the current file from private storage", async () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const download = vi.fn().mockResolvedValue({ data: blob, error: null });
    const client = {
      storage: {
        from: vi.fn().mockReturnValue({ download }),
      },
      from: vi.fn().mockReturnValueOnce(selectCurrentResult(oldRecord)),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const result = await createSupabaseSowingPlanDocumentRepository().downloadCurrent();

    expect(result?.document.storagePath).toBe("current/old.pdf");
    expect(result?.file).toBe(blob);
    expect(download).toHaveBeenCalledWith("current/old.pdf");
  });
});

function selectCurrentResult(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
          }),
        }),
      }),
    }),
  };
}

function insertResult(error: unknown = null) {
  return {
    insert: vi.fn().mockResolvedValue({ error }),
  };
}

function updateEqResult(error: unknown = null) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error }),
    }),
  };
}

function updateSelectSingleResult(data: unknown, error: unknown = null) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    }),
  };
}

function deleteResult(error: unknown = null) {
  return {
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error }),
    }),
  };
}
