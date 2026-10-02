import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { extractProductionPlan } from "@/lib/server/production-plan-extractor";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("image");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected image file." }, { status: 400 });
  }

  if (!["image/jpeg", "image/png"].includes(file.type)) {
    return NextResponse.json({ error: "Only JPG and PNG images are supported." }, { status: 400 });
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large. Maximum size is 10 MB." }, { status: 413 });
  }

  const result = await extractProductionPlan(file);

  if (!result.providerConfigured) {
    return NextResponse.json(result, { status: 503 });
  }

  return NextResponse.json(result);
}
