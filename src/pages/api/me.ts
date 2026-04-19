import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyUser } from '@/lib/supabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ profile: null });

  const auth = await verifyUser(token);
  if (!auth) return res.status(401).json({ profile: null });

  return res.status(200).json({ profile: auth.profile });
}
