import "server-only";
import type { SowingPlanDocument } from "@/lib/types";
import type { SowingPlanDocumentRecord } from "@/lib/supabase/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const SOWING_PLAN_DOCUMENT_BUCKET = "small-plants-plan-documents";
export const MAX_SOWING_PLAN_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_SOWING_PLAN_DOCUMENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

export class SowingPlanDocumentPersistenceError extends Error {
  code?: string;
  details?: string;
  hint?: string;

  constructor(message: string, error?: unknown) {
    super(error ? `${message}: ${supabaseErrorSummary(error)}` : message);
    this.name = "SowingPlanDocumentPersistenceError";

    const candidate = error as { code?: unknown; details?: unknown; hint?: unknown };
    this.code = typeof candidate?.code === "string" ? candidate.code : undefined;
    this.details = typeof candidate?.details === "string" ? candidate.details : undefined;
    this.hint = typeof candidate?.hint === "string" ? candidate.hint : undefined;
  }
}

export function isSupabasePlanDocumentError(error: unknown): error is SowingPlanDocumentPersistenceError {
  return error instanceof SowingPlanDocumentPersistenceError;
}

export type SowingPlanDocumentRepository = {
  downloadCurrent: () => Promise<{ document: SowingPlanDocument; file: Blob } | null>;
  loadCurrent: () => Promise<SowingPlanDocument | null>;
  saveCurrent: (file: File) => Promise<SowingPlanDocument>;
};

export function createSupabaseSowingPlanDocumentRepository(): SowingPlanDocumentRepository {
  return {
    downloadCurrent,
    loadCurrent,
    saveCurrent,
  };
}

async function loadCurrent(): Promise<SowingPlanDocument | null> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("sowing_plan_documents")
    .select("*")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new SowingPlanDocumentPersistenceError("Neizdevās ielādēt sēšanas plāna dokumentu", error);
  }

  return data ? recordToSowingPlanDocument(data as SowingPlanDocumentRecord) : null;
}

async function saveCurrent(file: File): Promise<SowingPlanDocument> {
  validateSowingPlanDocumentFile(file);

  const client = createSupabaseServerClient();
  const oldDocument = await loadCurrent();
  const storagePath = createStoragePath(file);
  const newId = crypto.randomUUID();
  const record: SowingPlanDocumentRecord = {
    id: newId,
    storage_bucket: SOWING_PLAN_DOCUMENT_BUCKET,
    storage_path: storagePath,
    original_file_name: file.name || "sowing-plan",
    content_type: file.type as SowingPlanDocumentRecord["content_type"],
    file_size_bytes: file.size,
    is_current: false,
  };

  const storage = client.storage.from(SOWING_PLAN_DOCUMENT_BUCKET);
  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await storage.upload(storagePath, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (upload.error) {
    throw new SowingPlanDocumentPersistenceError("Neizdevās augšupielādēt sēšanas plāna failu", upload.error);
  }

  try {
    const insert = await client.from("sowing_plan_documents").insert(record);
    if (insert.error) {
      throw new SowingPlanDocumentPersistenceError("Neizdevās saglabāt sēšanas plāna metadatus", insert.error);
    }

    if (oldDocument) {
      const markOld = await client.from("sowing_plan_documents").update({ is_current: false }).eq("id", oldDocument.id);
      if (markOld.error) {
        throw new SowingPlanDocumentPersistenceError("Neizdevās aizvērt iepriekšējo sēšanas plānu", markOld.error);
      }
    } else {
      const clearCurrent = await client.from("sowing_plan_documents").update({ is_current: false }).eq("is_current", true);
      if (clearCurrent.error) {
        throw new SowingPlanDocumentPersistenceError("Neizdevās sagatavot sēšanas plāna nomaiņu", clearCurrent.error);
      }
    }

    const markNew = await client
      .from("sowing_plan_documents")
      .update({ is_current: true })
      .eq("id", newId)
      .select("*")
      .single();
    if (markNew.error) {
      if (oldDocument) {
        await client.from("sowing_plan_documents").update({ is_current: true }).eq("id", oldDocument.id);
      }
      throw new SowingPlanDocumentPersistenceError("Neizdevās aktivizēt jauno sēšanas plānu", markNew.error);
    }

    return recordToSowingPlanDocument(markNew.data as SowingPlanDocumentRecord);
  } catch (error) {
    await storage.remove([storagePath]).catch(() => undefined);
    try {
      await client.from("sowing_plan_documents").delete().eq("id", newId);
    } catch {
      // Best-effort cleanup only. The uploaded storage object has already been removed.
    }
    throw error;
  }
}

async function downloadCurrent(): Promise<{ document: SowingPlanDocument; file: Blob } | null> {
  const document = await loadCurrent();
  if (!document) {
    return null;
  }

  const client = createSupabaseServerClient();
  const { data, error } = await client.storage.from(document.storageBucket).download(document.storagePath);
  if (error || !data) {
    throw new SowingPlanDocumentPersistenceError("Neizdevās atvērt sēšanas plāna failu", error);
  }

  return { document, file: data };
}

export function validateSowingPlanDocumentFile(file: File): void {
  if (!ALLOWED_SOWING_PLAN_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_SOWING_PLAN_DOCUMENT_TYPES)[number])) {
    throw new Error("Atļauti tikai JPEG, PNG vai PDF faili.");
  }

  if (file.size <= 0) {
    throw new Error("Fails ir tukšs.");
  }

  if (file.size > MAX_SOWING_PLAN_DOCUMENT_BYTES) {
    throw new Error("Fails ir par lielu. Maksimums ir 10 MB.");
  }
}

function recordToSowingPlanDocument(record: SowingPlanDocumentRecord): SowingPlanDocument {
  return {
    id: record.id,
    contentType: record.content_type,
    createdAt: record.created_at,
    fileSizeBytes: record.file_size_bytes,
    isCurrent: record.is_current,
    originalFileName: record.original_file_name,
    storageBucket: record.storage_bucket,
    storagePath: record.storage_path,
    updatedAt: record.updated_at,
  };
}

function createStoragePath(file: File): string {
  const extension = extensionForContentType(file.type);
  const date = new Date().toISOString().slice(0, 10);
  return `current/${date}-${crypto.randomUUID()}${extension}`;
}

function extensionForContentType(contentType: string): string {
  if (contentType === "image/png") {
    return ".png";
  }

  if (contentType === "application/pdf") {
    return ".pdf";
  }

  return ".jpg";
}

function supabaseErrorSummary(error: unknown): string {
  const candidate = error as { code?: unknown; details?: unknown; hint?: unknown; message?: unknown };
  const parts = [
    typeof candidate?.code === "string" ? candidate.code : "",
    typeof candidate?.message === "string" ? candidate.message : "",
    typeof candidate?.details === "string" ? candidate.details : "",
    typeof candidate?.hint === "string" ? candidate.hint : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Supabase operation failed.";
}
