import { useState } from 'react';
import type { CampaignRef } from '@/lib/api';
import { PasscodeGate } from '@/components/PasscodeGate';
import { SpinStage } from '@/components/SpinStage';

export default function App() {
  // sessionStorage, not localStorage: a shared event laptop must not remember
  // the passcode after the browser closes.
  const [session, setSession] = useState<{ campaign: CampaignRef; passcode: string } | null>(() => {
    const raw = sessionStorage.getItem('ww_session');
    return raw ? (JSON.parse(raw) as { campaign: CampaignRef; passcode: string }) : null;
  });

  if (!session) {
    return (
      <PasscodeGate
        onUnlock={(campaign, passcode) => {
          sessionStorage.setItem('ww_session', JSON.stringify({ campaign, passcode }));
          setSession({ campaign, passcode });
        }}
      />
    );
  }

  return <SpinStage campaign={session.campaign} passcode={session.passcode} />;
}
