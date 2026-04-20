import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import clsx from 'clsx';
import {
  Shield, CheckCircle, AlertTriangle, Loader2, Copy, ChevronRight,
  Database, User, Eye, EyeOff, ExternalLink,
} from 'lucide-react';

type Step = 'migrate' | 'admin' | 'done';

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep]         = useState<Step>('migrate');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [manualSQL, setManualSQL] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [copied, setCopied]     = useState(false);

  /* ── Step 1: migrate ─────────────────────────────────────── */
  const runMigration = async () => {
    setBusy(true); setError('');
    try {
      const res  = await fetch('/api/setup/migrate', { method: 'POST' });
      const data = await res.json();

      if (data.ok) {
        setStep('admin');
        return;
      }

      // DB already set up — advance to admin creation
      if (res.status === 400 && data.error?.includes('already set up')) {
        setStep('admin');
        return;
      }

      if (data.manual && data.sql) {
        setManualSQL(data.sql);
        setError(data.hint ?? 'Auto-migration failed. Paste the SQL manually, then click "I ran the SQL" below.');
        return;
      }

      setError(data.error ?? 'Migration failed.');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copySQL = async () => {
    try {
      await navigator.clipboard.writeText(manualSQL);
    } catch {
      // clipboard API unavailable (non-HTTPS or older browser) — user can select manually
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ── Step 2: create admin ─────────────────────────────────── */
  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res  = await fetch('/api/setup/admin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      if (data.alreadyExists) { setEmail(data.email || email); }
      setStep('done');
    } finally {
      setBusy(false);
    }
  };

  /* ── Render ───────────────────────────────────────────────── */
  return (
    <>
      <Head>
        <title>Setup · Claim Validation Portal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {/* Brand */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 flex items-center justify-center shadow-lg mx-auto mb-4">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">First-Time Setup</h1>
            <p className="text-sm text-slate-500 mt-1">Claim Validation Portal — one-time configuration</p>
          </div>

          {/* Progress steps */}
          <div className="flex items-center gap-2 mb-6 justify-center">
            {(['migrate', 'admin', 'done'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={clsx(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                  step === s
                    ? 'bg-brand-700 text-white'
                    : (['admin', 'done'] as Step[]).indexOf(step) > i
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-500',
                )}>
                  {(['admin', 'done'] as Step[]).indexOf(step) > i
                    ? <CheckCircle className="w-4 h-4" />
                    : i + 1}
                </div>
                <span className="text-xs text-slate-600 hidden sm:inline">
                  {s === 'migrate' ? 'Database' : s === 'admin' ? 'Admin Account' : 'Done'}
                </span>
                {i < 2 && <ChevronRight className="w-4 h-4 text-slate-300" />}
              </div>
            ))}
          </div>

          {/* ── STEP 1: Migration ── */}
          {step === 'migrate' && (
            <div className="card">
              <div className="card-header">
                <div className="icon-tile bg-gradient-to-br from-violet-500 to-violet-700">
                  <Database className="w-4 h-4 text-white" />
                </div>
                <h2 className="section-title text-base">Step 1 — Create Database Tables</h2>
              </div>
              <div className="card-body space-y-4">
                <p className="text-sm text-slate-600">
                  Click the button below to automatically create the required database tables and security policies.
                </p>

                {error && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <p className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      {error}
                    </p>
                  </div>
                )}

                {manualSQL ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <pre className="text-xs bg-slate-900 text-slate-100 p-4 rounded-lg overflow-auto max-h-60 font-mono">
                        {manualSQL}
                      </pre>
                      <button onClick={copySQL}
                        className="absolute top-2 right-2 btn-secondary h-7 px-2 text-xs">
                        <Copy className="w-3 h-3" />
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <ol className="text-xs text-slate-600 space-y-1 pl-4 list-decimal">
                      <li>Copy the SQL above</li>
                      <li>
                        Open{' '}
                        <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer"
                          className="text-brand-700 underline inline-flex items-center gap-0.5">
                          Supabase Dashboard <ExternalLink className="w-3 h-3" />
                        </a>
                        {' '}→ SQL Editor
                      </li>
                      <li>Paste and click Run</li>
                    </ol>
                    <button onClick={() => setStep('admin')} className="btn-primary w-full">
                      I ran the SQL, continue <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button onClick={runMigration} disabled={busy} className="btn-primary w-full">
                    {busy
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Running migration…</>
                      : <><Database className="w-4 h-4" /> Create Database Tables</>}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 2: Admin account ── */}
          {step === 'admin' && (
            <div className="card">
              <div className="card-header">
                <div className="icon-tile bg-gradient-to-br from-brand-500 to-brand-700">
                  <User className="w-4 h-4 text-white" />
                </div>
                <h2 className="section-title text-base">Step 2 — Create Admin Account</h2>
              </div>
              <form onSubmit={createAdmin} className="card-body space-y-4">
                {error && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                  </div>
                )}
                <div>
                  <label className="label">Admin Email</label>
                  <input type="email" className="input-field" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@yourdomain.com" autoFocus />
                </div>
                <div>
                  <label className="label">Password (min 8 chars)</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} className="input-field pr-10" required minLength={8}
                      value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={busy} className="btn-primary w-full">
                  {busy
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account…</>
                    : <><User className="w-4 h-4" /> Create Admin Account</>}
                </button>
              </form>
            </div>
          )}

          {/* ── STEP 3: Done ── */}
          {step === 'done' && (
            <div className="card text-center">
              <div className="card-body py-10 space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Setup Complete!</h2>
                <p className="text-sm text-slate-600">
                  Admin account created for <span className="font-semibold text-slate-800">{email}</span>.
                  Sign in to access the portal and admin dashboard.
                </p>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  This setup page is now permanently disabled.
                </p>
                <button onClick={() => router.push('/login')} className="btn-primary mx-auto">
                  Go to Sign In <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
