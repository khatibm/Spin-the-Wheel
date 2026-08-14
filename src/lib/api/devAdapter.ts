import type { CampaignRef, RevealResult, SpinApi, SpinResult, StageInfo } from './types';
import { RpcError } from './types';

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new RpcError(String(json?.error ?? 'ERROR'));
  return json as T;
}

export function devAdapter(): SpinApi {
  return {
    resolveCampaign: (passcode) => call<CampaignRef>('resolve_campaign', { passcode }),

    stageInfo: (campaign_id, passcode) =>
      call<StageInfo>('campaign_stage_info', { campaign_id, passcode }),

    spin: ({ campaignId, passcode, prizeId, isTest, actorLabel }) =>
      call<SpinResult>('spin_campaign', {
        campaign_id: campaignId,
        passcode,
        prize_id: prizeId ?? null,
        is_test: isTest,
        actor_label: actorLabel ?? null,
      }),

    reveal: (spin_id, passcode) => call<RevealResult>('reveal_winner', { spin_id, passcode }),
  };
}
