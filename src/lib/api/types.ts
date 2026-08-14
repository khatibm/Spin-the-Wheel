export type CampaignRef = {
  id: string;
  name: string;
  name_ar: string | null;
  tagline: string | null;
  tagline_ar: string | null;
  status: string;
};

export type Prize = {
  id: string;
  name: string;
  name_ar: string | null;
  value: number | null;
  currency: string;
  tier: number;
  color: string | null;
  total: number;
  remaining: number;
};

export type Segment = {
  index: number;
  prize_id: string;
  name: string;
  name_ar: string | null;
  value: number | null;
  currency: string;
  color: string | null;
};

export type StageInfo = {
  campaign: CampaignRef & { allow_previous_winners: boolean; segment_count: number };
  counts: { total_customers: number; eligible: number; winners: number };
  prizes: Prize[];
  segments: Segment[];
};

/**
 * The result of a spin. The winner has ALREADY been committed server-side by
 * the time this arrives -- the animation only visualises `winner_index`.
 *
 * `test_winner` is populated only in test mode, where nothing was persisted.
 * A real spin deliberately withholds the identity until reveal_winner().
 */
export type SpinResult = {
  spin_id: string | null;
  is_test: boolean;
  spin_seq: number;
  pool_size: number;
  segment_count: number;
  winner_index: number;
  segments: Segment[];
  prize: { id: string; name: string; name_ar: string | null; value: number | null; currency: string; color: string | null };
  test_winner: null | {
    full_name: string;
    full_name_ar: string | null;
    masked_mobile: string;
    city: string | null;
  };
};

export type RevealResult = {
  spin_id: string;
  spin_seq: number;
  reference: string;
  full_name: string;
  full_name_ar: string | null;
  masked_mobile: string;
  city: string | null;
  selected_at: string;
  prize: { name: string; name_ar: string | null; value: number | null; currency: string };
};

export interface SpinApi {
  resolveCampaign(passcode: string): Promise<CampaignRef>;
  stageInfo(campaignId: string, passcode: string): Promise<StageInfo>;
  spin(a: {
    campaignId: string;
    passcode: string;
    prizeId?: string | null;
    isTest: boolean;
    actorLabel?: string;
  }): Promise<SpinResult>;
  reveal(spinId: string, passcode: string): Promise<RevealResult>;
}

/** Typed error codes raised by the SQL layer (spec section 44). */
export class RpcError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'RpcError';
  }
}
