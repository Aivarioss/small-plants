import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("production plan extract API", () => {
  it("requires an authenticated Small Plants session", async () => {
    const formData = new FormData();
    formData.append("image", new File(["demo"], "plan.png", { type: "image/png" }));
    const request = new NextRequest("http://localhost/api/production-plan/extract", {
      body: formData,
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
