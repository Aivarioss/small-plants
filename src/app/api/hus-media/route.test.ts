import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { createSupabaseHusMediaRepository, MAX_HUS_PHOTO_BYTES } from "@/lib/repositories/supabase-hus-media-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  hasValidSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseServerConfigured: vi.fn(),
}));

vi.mock("@/lib/repositories/supabase-hus-media-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/supabase-hus-media-repository")>();
  return {
    ...actual,
    createSupabaseHusMediaRepository: vi.fn(),
  };
});

describe("HUS media API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasValidSession).mockResolvedValue(true);
    vi.mocked(isSupabaseServerConfigured).mockReturnValue(true);
  });

  it("requires an authenticated Small Plants session", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await POST(uploadRequest(new File(["demo"], "photo.jpg", { type: "image/jpeg" })));

    expect(response.status).toBe(401);
  });

  it("saves a note and photos through the protected repository", async () => {
    const save = vi.fn().mockResolvedValue({
      note: {
        id: "note-id",
        note: "Pārbaudīt C4",
        photos: [],
        sowingPlanRowId: "row-id",
      },
      photos: [],
    });
    vi.mocked(createSupabaseHusMediaRepository).mockReturnValue({
      downloadPhoto: vi.fn(),
      save,
    });

    const response = await POST(uploadRequest(new File(["demo"], "photo.jpg", { type: "image/jpeg" }), { note: "Pārbaudīt C4" }));

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ note: "Pārbaudīt C4", rowId: "row-id" }));
    await expect(response.json()).resolves.toMatchObject({ note: { note: "Pārbaudīt C4" } });
  });

  it("rejects unsupported MIME types", async () => {
    const response = await POST(uploadRequest(new File(["demo"], "photo.gif", { type: "image/gif" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Atļauti tikai JPEG vai PNG attēli." });
  });

  it("rejects files over 10 MB", async () => {
    const file = new File([new Uint8Array(MAX_HUS_PHOTO_BYTES + 1)], "photo.jpg", { type: "image/jpeg" });

    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Fotogrāfija ir par lielu. Maksimums ir 10 MB." });
  });
});

function uploadRequest(file: File, fields: { eventId?: string; note?: string } = {}): NextRequest {
  const formData = new FormData();
  formData.append("rowId", "row-id");
  if (fields.eventId) {
    formData.append("eventId", fields.eventId);
  }
  if (fields.note) {
    formData.append("note", fields.note);
  }
  formData.append("photos", file);

  return new NextRequest("http://localhost/api/hus-media", {
    body: formData,
    method: "POST",
  });
}
