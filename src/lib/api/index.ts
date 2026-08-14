/**
 * Adapter selection.
 *
 * Both adapters call the SAME SQL functions -- one through Supabase's PostgREST
 * RPC endpoint, one through the local dev bridge. There is exactly one
 * implementation of the selection logic, and it lives in supabase/migrations.
 */
import type { SpinApi } from './types';
import { devAdapter } from './devAdapter';
import { supabaseAdapter } from './supabaseAdapter';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const api: SpinApi = url && key ? supabaseAdapter(url, key) : devAdapter();

export const usingSupabase = Boolean(url && key);
export * from './types';
