import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdminClient } from '@/lib/supabaseAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8)  return res.status(400).json({ error: 'password must be at least 8 characters' });

  const adminClient = getAdminClient();

  // Check if tables exist and if any admin already exists
  const { data: existingAdmin, error: checkErr } = await adminClient
    .from('profiles')
    .select('id, email')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (checkErr) {
    return res.status(500).json({
      error: `Database tables not found. Run the SQL migration first. (${checkErr.message})`,
    });
  }

  if (existingAdmin) {
    return res.status(200).json({ ok: true, alreadyExists: true, email: existingAdmin.email ?? '' });
  }

  // Check if user already exists in auth (from a previous failed attempt)
  const { data: { users: existingUsers } } = await adminClient.auth.admin.listUsers();
  const existingAuthUser = existingUsers?.find(u => u.email === email);

  let userId: string;

  if (existingAuthUser) {
    // Auth user exists but profile wasn't created — reuse them
    userId = existingAuthUser.id;
  } else {
    // Create auth user
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) return res.status(400).json({ error: createErr.message });
    userId = created.user.id;
  }

  // Insert or upsert admin profile
  const { error: profileErr } = await adminClient.from('profiles').upsert({
    id:        userId,
    email,
    role:      'admin',
    is_active: true,
  }, { onConflict: 'id' });

  if (profileErr) {
    return res.status(500).json({
      error: `Profile creation failed: ${profileErr.message}. The tables may not exist yet.`,
    });
  }

  try {
    await adminClient.from('activity_logs').insert({
      user_id:  userId,
      email,
      action:   'admin_setup',
      metadata: { setup: true },
    });
  } catch { /* non-critical */ }

  return res.status(201).json({ ok: true, email });
}
