import { createClient } from '@supabase/supabase-js';
import type { CampaignRef, RevealResult, SpinApi, SpinResult, StageInfo } from './types';
import { RpcError } from './types';

/**
 * Talks to the same SQL functions through PostgREST. The anon key grants
 * nothing beyond EXECUTE on the five RPCs -- see 0007_rls_and_grants.sql.
 */
export function supabaseAdapter(url: string, anonKey: string): SpinApi {
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });

  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      // Postgres RAISE messages arrive in `message`; keep the first line so the
      // UI maps the same typed codes in both adapters.
      throw new RpcError(String(error.message ?? 'ERROR').split('\n')[0]);
    }
    return data as T;
  };

  return {
    resolveCampaign: (p_passcode) => rpc<CampaignRef>('resolve_campaign', { p_passcode }),

    stageInfo: (p_campaign_id, p_passcode) =>
      rpc<StageInfo>('campaign_stage_info', { p_campaign_id, p_passcode }),

    spin: ({ campaignId, passcode, prizeId, isTest, actorLabel }) =>
      rpc<SpinResult>('spin_campaign', {
        p_campaign_id: campaignId,
        p_passcode: passcode,
        p_prize_id: prizeId ?? null,
        p_is_test: isTest,
        p_actor_label: actorLabel ?? null,
      }),

    reveal: (p_spin_id, p_passcode) => rpc<RevealResult>('reveal_winner', { p_spin_id, p_passcode }),
  };
}
