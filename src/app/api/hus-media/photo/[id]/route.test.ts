import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { createSupabaseHusMediaRepository } from "@/lib/repositories/supabase-hus-media-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { DELETE, GET } from "./route";

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

describe("HUS media photo API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasValidSession).mockResolvedValue(true);
    vi.mocked(isSupabaseServerConfigured).mockReturnValue(true);
  });

  it("requires an authenticated Small Plants session", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await GET(new NextRequest("http://localhost/api/hus-media/photo/photo-id"), params("photo-id"));

    expect(response.status).toBe(401);
  });

  it("returns the private storage image inline", async () => {
    vi.mocked(createSupabaseHusMediaRepository).mockReturnValue({
      deletePhoto: vi.fn(),
      downloadPhoto: vi.fn().mockResolvedValue({
        file: new Blob(["jpg"], { type: "image/jpeg" }),
        photo: {
          id: "photo-id",
          contentType: "image/jpeg",
          fileSizeBytes: 3,
          originalFileName: "saknes.jpg",
          sowingPlanRowId: "row-id",
          storageBucket: "small-plants-hus-photos",
          storagePath: "hus/row-id/photo.jpg",
        },
      }),
      save: vi.fn(),
    });

    const response = await GET(new NextRequest("http://localhost/api/hus-media/photo/photo-id"), params("photo-id"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    await expect(response.text()).resolves.toBe("jpg");
  });

  it("deletes a private HUS photo through the protected API", async () => {
    const deletePhoto = vi.fn().mockResolvedValue({ storageRemoved: true });
    vi.mocked(createSupabaseHusMediaRepository).mockReturnValue({
      deletePhoto,
      downloadPhoto: vi.fn(),
      save: vi.fn(),
    });

    const response = await DELETE(new NextRequest("http://localhost/api/hus-media/photo/photo-id"), params("photo-id"));

    expect(response.status).toBe(200);
    expect(deletePhoto).toHaveBeenCalledWith("photo-id");
    await expect(response.json()).resolves.toEqual({ ok: true, storageRemoved: true });
  });

  it("requires authentication for deleting a photo", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);

    const response = await DELETE(new NextRequest("http://localhost/api/hus-media/photo/photo-id"), params("photo-id"));

    expect(response.status).toBe(401);
  });
});

function params(id: string) {
  return {
    params: Promise.resolve({ id }),
  };
}
