import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function isSupabaseServerConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
