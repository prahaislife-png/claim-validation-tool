import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, type Profile } from './supabase';

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileMissing: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

// Fetch profile via server-side API route — uses service role key,
// so it works regardless of the browser client's anon key format.
async function fetchProfileViaApi(session: Session): Promise<Profile | null> {
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.profile ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]                     = useState<User | null>(null);
  const [profile, setProfile]               = useState<Profile | null>(null);
  const [loading, setLoading]               = useState(true);
  const [profileMissing, setProfileMissing] = useState(false);

  async function resolveProfile(session: Session | null) {
    if (!session) {
      setProfile(null);
      setProfileMissing(false);
      return;
    }
    const p = await fetchProfileViaApi(session);
    setProfile(p);
    setProfileMissing(p === null);
  }

  useEffect(() => {
    let isMounted = true;

    // getSession — wrapped so a synchronous throw (e.g. missing env vars) is caught
    // and does not propagate as a fatal React error, causing the white screen.
    const initSession = async () => {
      try {
        console.log('[CVP] Auth: initializing session');
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        setUser(session?.user ?? null);
        await resolveProfile(session);
        console.log('[CVP] Auth: session ready, user =', session?.user?.email ?? 'none');
      } catch (err) {
        console.error('[CVP] Auth: getSession failed —', err instanceof Error ? err.message : err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initSession();

    // onAuthStateChange — also wrapped; if the proxy throws (missing env vars) we
    // catch it and skip the listener rather than crashing the whole app.
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (!isMounted) return;
        setUser(session?.user ?? null);
        await resolveProfile(session);
      });
      subscription = data.subscription;
    } catch (err) {
      console.error('[CVP] Auth: onAuthStateChange failed —', err instanceof Error ? err.message : err);
    }

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setProfileMissing(false);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, profileMissing, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export async function logAction(action: string, metadata?: Record<string, unknown>) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch('/api/log-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, metadata }),
    });
  } catch { /* non-critical */ }
}
