import { createClient } from '@supabase/supabase-js';

// Lazy singleton — avoids throwing during Next.js static build when env vars aren't set.
let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      const msg =
        'Missing Supabase env vars. ' +
        'Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
        'in Vercel → Project Settings → Environment Variables (all environments).';
      console.error('[CVP]', msg);
      throw new Error(msg);
    }
    console.log('[CVP] Supabase client initializing for', new URL(url).hostname);
    _client = createClient(url, key);
  }
  return _client;
}

export const supabase: ReturnType<typeof createClient> = new Proxy(
  {} as ReturnType<typeof createClient>,
  { get: (_, prop) => getClient()[prop as keyof ReturnType<typeof createClient>] },
);

export type Profile = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  created_by: string | null;
};

export type ActivityLog = {
  id: string;
  user_id: string | null;
  email: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ClaimSubmission = {
  id: string;
  user_id: string | null;
  email: string | null;
  partner_id: string | null;
  partner_name: string | null;
  request_number: string | null;
  claim_data: Record<string, unknown>;
  document_count: number;
  decision: string | null;
  confidence: number | null;
  created_at: string;
};
