import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import Head from 'next/head';
import clsx from 'clsx';
import {
  Upload, FileText, Image as ImageIcon, File as FileIcon, X, CheckCircle, XCircle,
  AlertTriangle, ChevronRight, Loader2, Shield, BarChart3, ClipboardList,
  FileCheck, AlertOctagon, Info, FileSpreadsheet, Building2,
  Calendar, Euro, Hash, Clock, Sparkles,
  FileSearch, Layers, Plus, ArrowRight, Printer, FileDown, LogOut, Settings,
} from 'lucide-react';
import type {
  ClaimFormData, UploadedDocument, ValidationResult, StatusType, SeverityType, DecisionType,
} from '@/lib/types';
import { useAuth, logAction } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const CATEGORIES = ['Event', 'Content Syndication', 'Digital Marketing', 'Telemarketing', 'Training', 'Trade Show', 'Other'];
const ACTIVITY_TYPES = ['Event', 'Digital', 'Content', 'Training', 'Demand Generation', 'Other'];
const ACTIVITY_MAP: Record<string, string[]> = {
  Event: ['Physical Events (SAP Led)', 'Physical Events (Partner Led)', 'Virtual Events', 'Webinar', 'Trade Show', 'Co-branded Event'],
  Digital: ['Email Campaign', 'Social Media', 'Search/PPC', 'Display Advertising', 'Retargeting', 'SEO'],
  Content: ['Case Study', 'White Paper', 'Blog Post', 'Video Production', 'Infographic', 'Newsletter'],
  Training: ['Partner Training', 'End Customer Training', 'Workshop', 'Certification'],
  'Demand Generation': ['Telemarketing', 'Inside Sales Support', 'Lead Generation', 'ABM Campaign'],
  Other: ['Other'],
};

const REQUIRED: (keyof ClaimFormData)[] = ['partnerId', 'partnerName'];

const FIELD_LABELS: Record<keyof ClaimFormData, string> = {
  partnerId: 'Partner ID',
  partnerName: 'Partner Name',
  budgetPeriodFrom: 'Budget Period From',
  budgetPeriodTo: 'Budget Period To',
  budgetAllocationAmount: 'Budget Allocation (€)',
  category: 'Category',
  requestNumber: 'Request Number',
  activityType: 'Activity Type',
  activity: 'Activity',
  fundRequestSubmittedDate: 'Fund Request Submitted',
  fundApprovedDate: 'Fund Approved Date',
  activityStartDate: 'Activity Start Date',
  activityEndDate: 'Activity End Date',
  fundingApproved: 'Funding Approved (€)',
};

const EMPTY_FORM: ClaimFormData = {
  partnerId: '', partnerName: '', budgetPeriodFrom: '', budgetPeriodTo: '',
  budgetAllocationAmount: '', category: '', requestNumber: '', activityType: '',
  activity: '', fundRequestSubmittedDate: '', fundApprovedDate: '',
  activityStartDate: '', activityEndDate: '', fundingApproved: '',
};

const STATUS_STYLES: Record<StatusType, { cls: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pass:    { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200',  label: 'Pass',    Icon: CheckCircle },
  fail:    { cls: 'text-red-700 bg-red-50 border-red-200',              label: 'Fail',    Icon: XCircle },
  warning: { cls: 'text-amber-700 bg-amber-50 border-amber-200',        label: 'Warning', Icon: AlertTriangle },
  missing: { cls: 'text-slate-700 bg-slate-100 border-slate-200',       label: 'Missing', Icon: AlertOctagon },
  partial: { cls: 'text-blue-700 bg-blue-50 border-blue-200',           label: 'Partial', Icon: Info },
};

const SEVERITY_STYLES: Record<SeverityType, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high:     'bg-orange-100 text-orange-800 border-orange-200',
  medium:   'bg-amber-100 text-amber-800 border-amber-200',
  low:      'bg-blue-100 text-blue-800 border-blue-200',
  info:     'bg-slate-100 text-slate-700 border-slate-200',
};

const DECISION_STYLES: Record<DecisionType, { bg: string; ring: string; text: string; Icon: React.ComponentType<{ className?: string }>; label: string }> = {
  APPROVED:     { bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100', ring: 'ring-emerald-300', text: 'text-emerald-900', Icon: CheckCircle,    label: 'Approved' },
  REJECTED:     { bg: 'bg-gradient-to-br from-red-50 to-red-100',         ring: 'ring-red-300',     text: 'text-red-900',     Icon: XCircle,        label: 'Rejected' },
  NEEDS_REVIEW: { bg: 'bg-gradient-to-br from-amber-50 to-amber-100',     ring: 'ring-amber-300',   text: 'text-amber-900',   Icon: AlertTriangle,  label: 'Needs Review' },
};

function getFileIcon(name: string, type: string) {
  if (type === 'application/pdf' || name.endsWith('.pdf')) return <FileText className="w-5 h-5 text-red-500" />;
  if (type.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-violet-500" />;
  if (/\.(xlsx|xls|csv)$/i.test(name)) return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
  if (/\.(docx|doc)$/i.test(name)) return <FileText className="w-5 h-5 text-brand-600" />;
  return <FileIcon className="w-5 h-5 text-slate-400" />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Page() {
  const { user, profile, loading: authLoading, profileMissing, signOut } = useAuth();
  const router = useRouter();

  const [claim, setClaim] = useState<ClaimFormData>(EMPTY_FORM);
  const [docs, setDocs] = useState<UploadedDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Partial<Record<keyof ClaimFormData, boolean>>>({});
  const [tab, setTab] = useState<'overview' | 'fields' | 'documents' | 'guidelines' | 'issues'>('overview');
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Still resolving session / profile
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
    </div>
  );

  if (!user) return null; // redirect handled by useEffect

  // Authenticated but no profile row — account not fully set up
  if (profileMissing) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card max-w-sm w-full text-center">
        <div className="card-body py-10 space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-bold text-slate-900">Account not fully set up</h2>
          <p className="text-sm text-slate-600">
            Your login was successful but no user profile was found. This usually means the
            admin setup did not complete. Please contact your administrator or re-run
            the setup at <a href="/setup" className="text-brand-700 underline">/setup</a>.
          </p>
          <button onClick={async () => { await signOut(); router.replace('/login'); }}
            className="btn-secondary mx-auto">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );

  if (!profile) return null;

  const STEPS = useMemo(() => ([
    'Extracting content from documents',
    'Cross-referencing claim fields',
    'Checking guideline compliance',
    'Running AI document analysis',
    'Generating validation report',
  ]), []);

  const setField = (key: keyof ClaimFormData, value: string) => {
    setClaim(prev => key === 'activityType' ? { ...prev, activityType: value, activity: '' } : { ...prev, [key]: value });
    if (errs[key]) setErrs(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const validate = () => {
    const next: typeof errs = {};
    for (const k of REQUIRED) if (!claim[k]?.trim()) next[k] = true;
    setErrs(next);
    return Object.keys(next).length === 0;
  };

  const readFile = (file: File): Promise<UploadedDocument> => new Promise((resolve, reject) => {
    const isText = file.type.startsWith('text/') || /\.(txt|csv|json|xml|log|md)$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const result = reader.result as string;
      const content = isText ? result : (result.split(',')[1] ?? result);
      resolve({
        id: Math.random().toString(36).slice(2),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        content,
        isText,
      });
    };
    if (isText) reader.readAsText(file); else reader.readAsDataURL(file);
  });

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    const added: UploadedDocument[] = [];
    for (const f of list) {
      if (docs.some(d => d.name === f.name && d.size === f.size)) continue;
      if (f.size > 25 * 1024 * 1024) { setError(`${f.name} exceeds 25MB size limit`); continue; }
      try { added.push(await readFile(f)); } catch { /* skip */ }
    }
    setDocs(d => [...d, ...added]);
  }, [docs]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const submit = async () => {
    if (!validate()) { setError('Partner ID and Partner Name are required'); return; }
    if (docs.length === 0) { setError('Please upload at least one supporting document'); return; }
    setError(null); setResult(null); setBusy(true); setStep(0); setTab('overview');

    logAction('analysis_run', { partner_id: claim.partnerId, partner_name: claim.partnerName, doc_count: docs.length });

    const ticker = setInterval(() => setStep(s => (s < STEPS.length - 1 ? s + 1 : s)), 2200);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ claimData: claim, documents: docs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      setResult(data.result);
      logAction('result_view', { decision: data.result.decision, confidence: data.result.confidence });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      clearInterval(ticker); setBusy(false);
    }
  };

  const reset = () => { setClaim(EMPTY_FORM); setDocs([]); setResult(null); setError(null); setErrs({}); };

  const activities = ACTIVITY_MAP[claim.activityType] ?? [];
  const stats = result ? {
    pass: result.fieldValidations.filter(f => f.status === 'pass').length,
    fail: result.fieldValidations.filter(f => f.status === 'fail' || f.status === 'missing').length,
    warn: result.fieldValidations.filter(f => f.status === 'warning' || f.status === 'partial').length,
    total: result.fieldValidations.length,
    criticalIssues: result.issues.filter(i => i.severity === 'critical' || i.severity === 'high').length,
  } : null;

  return (
    <>
      <Head>
        <title>Claim Validation Portal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 flex items-center justify-center shadow-md">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-tight">Claim Validation Portal</h1>
                <p className="text-xs text-slate-500">
                  Partner Marketing Fund (MDF) Analysis
                  <span className="hidden sm:inline"> · A project by <span className="font-semibold text-brand-700">Govind Amilkanthwar</span></span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="badge-info hidden md:inline-flex">
                <Sparkles className="w-3 h-3" /> AI-Powered Analysis
              </span>
              {(result || error) && (
                <button onClick={reset} className="btn-secondary">
                  <Plus className="w-4 h-4" /> New Claim
                </button>
              )}
              {profile?.role === 'admin' && (
                <button onClick={() => router.push('/admin')} className="btn-secondary hidden sm:inline-flex">
                  <Settings className="w-4 h-4" /> Admin
                </button>
              )}
              <button
                onClick={async () => {
                  logAction('logout');
                  await signOut();
                  router.replace('/login');
                }}
                className="btn-secondary"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-6 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* LEFT: Form + Upload */}
            <div className="lg:col-span-2 space-y-5">
              {/* Partner Details */}
              <section className="card">
                <div className="card-header">
                  <div className="icon-tile bg-gradient-to-br from-brand-500 to-brand-700">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="section-title">Partner Details</h2>
                </div>
                <div className="card-body grid grid-cols-2 gap-4">
                  <div className="col-span-1">
                    <label className="label">Partner ID *</label>
                    <input className={clsx('input-field', errs.partnerId && 'error')} placeholder="1557861"
                      value={claim.partnerId} onChange={e => setField('partnerId', e.target.value)} />
                  </div>
                  <div className="col-span-1">
                    <label className="label">Partner Name *</label>
                    <input className={clsx('input-field', errs.partnerName && 'error')} placeholder="s-peers AG"
                      value={claim.partnerName} onChange={e => setField('partnerName', e.target.value)} />
                  </div>
                </div>
              </section>

              {/* Budget & Funding */}
              <section className="card">
                <div className="card-header">
                  <div className="icon-tile bg-gradient-to-br from-emerald-500 to-emerald-700">
                    <Euro className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="section-title">Budget & Funding</h2>
                </div>
                <div className="card-body grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Budget Period From</label>
                    <input type="date" className="input-field"
                      value={claim.budgetPeriodFrom} onChange={e => setField('budgetPeriodFrom', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Budget Period To</label>
                    <input type="date" className="input-field"
                      value={claim.budgetPeriodTo} onChange={e => setField('budgetPeriodTo', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Budget Allocation (€)</label>
                    <input type="number" step="0.01" className="input-field"
                      placeholder="1614.77" value={claim.budgetAllocationAmount}
                      onChange={e => setField('budgetAllocationAmount', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Funding Approved (€)</label>
                    <input type="number" step="0.01" className="input-field"
                      placeholder="1614.77" value={claim.fundingApproved}
                      onChange={e => setField('fundingApproved', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Category</label>
                    <select className="input-field"
                      value={claim.category} onChange={e => setField('category', e.target.value)}>
                      <option value="">Select category</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {/* Request Details */}
              <section className="card">
                <div className="card-header">
                  <div className="icon-tile bg-gradient-to-br from-violet-500 to-violet-700">
                    <Hash className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="section-title">Request Details</h2>
                </div>
                <div className="card-body grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="label">Request Number</label>
                    <input className="input-field" placeholder="3UJNKL4QDMK"
                      value={claim.requestNumber} onChange={e => setField('requestNumber', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Activity Type</label>
                    <select className="input-field"
                      value={claim.activityType} onChange={e => setField('activityType', e.target.value)}>
                      <option value="">Select type</option>
                      {ACTIVITY_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Activity</label>
                    <select className="input-field" disabled={!claim.activityType}
                      value={claim.activity} onChange={e => setField('activity', e.target.value)}>
                      <option value="">{claim.activityType ? 'Select activity' : 'Pick activity type first'}</option>
                      {activities.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {/* Dates */}
              <section className="card">
                <div className="card-header">
                  <div className="icon-tile bg-gradient-to-br from-amber-500 to-orange-600">
                    <Calendar className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="section-title">Activity & Funding Dates</h2>
                </div>
                <div className="card-body grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Fund Request Submitted</label>
                    <input type="date" className="input-field"
                      value={claim.fundRequestSubmittedDate} onChange={e => setField('fundRequestSubmittedDate', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Fund Approved Date</label>
                    <input type="date" className="input-field"
                      value={claim.fundApprovedDate} onChange={e => setField('fundApprovedDate', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Activity Start Date</label>
                    <input type="date" className="input-field"
                      value={claim.activityStartDate} onChange={e => setField('activityStartDate', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Activity End Date</label>
                    <input type="date" className="input-field"
                      value={claim.activityEndDate} onChange={e => setField('activityEndDate', e.target.value)} />
                  </div>
                </div>
              </section>

              {/* Documents */}
              <section className="card">
                <div className="card-header justify-between">
                  <div className="flex items-center gap-3">
                    <div className="icon-tile bg-gradient-to-br from-rose-500 to-pink-700">
                      <Layers className="w-5 h-5 text-white" />
                    </div>
                    <h2 className="section-title">Supporting Documents</h2>
                  </div>
                  <span className="badge-neutral">{docs.length} uploaded</span>
                </div>
                <div className="card-body space-y-3">
                  <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={onDrop}
                    onClick={() => fileRef.current?.click()}
                    className={clsx(
                      'relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
                      drag ? 'border-brand-600 bg-brand-50' : 'border-slate-300 hover:border-brand-500 hover:bg-slate-50',
                    )}
                  >
                    <Upload className={clsx('w-8 h-8 mx-auto mb-2', drag ? 'text-brand-600' : 'text-slate-400')} />
                    <p className="text-sm font-medium text-slate-700">Drop files here or click to browse</p>
                    <p className="text-xs text-slate-500 mt-1">PDF, Images, DOCX, XLSX, CSV, TXT — up to 25MB</p>
                    <input ref={fileRef} type="file" multiple className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv,.json"
                      onChange={e => e.target.files && addFiles(e.target.files)} />
                  </div>

                  {docs.length > 0 && (
                    <ul className="space-y-2">
                      {docs.map(d => (
                        <li key={d.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 group">
                          {getFileIcon(d.name, d.type)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{d.name}</p>
                            <p className="text-xs text-slate-500">{formatSize(d.size)}</p>
                          </div>
                          <button onClick={() => setDocs(docs.filter(x => x.id !== d.id))}
                            className="p-1 text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition">
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* Submit */}
              <div className="sticky bottom-4">
                {error && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
                <button onClick={submit} disabled={busy} className="btn-primary w-full h-12 text-base">
                  {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Validating...</>
                        : <><FileSearch className="w-5 h-5" /> Validate Claim <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </div>

            {/* RIGHT: Results */}
            <div className="lg:col-span-3">
              <div className="lg:sticky lg:top-[80px]">
                {busy ? <LoadingPanel steps={STEPS} current={step} />
                  : result ? <ResultsPanel result={result} stats={stats!} tab={tab} setTab={setTab} onViewSummary={() => { setShowSummary(true); logAction('report_download', { decision: result.decision }); }} />
                  : <EmptyPanel />}
              </div>
            </div>
          </div>
        </main>

        <footer className="max-w-[1600px] mx-auto px-6 py-6 text-center text-xs text-slate-500 space-y-1">
          <p>Powered by Claude AI · A project by <span className="font-semibold text-slate-700">Govind Amilkanthwar</span></p>
          <p>Results are analytical recommendations and require human review for final approval.</p>
        </footer>

        {showSummary && result && (
          <SummaryModal claim={claim} result={result} onClose={() => setShowSummary(false)} />
        )}
      </div>
    </>
  );
}

// -------------------- Sub-panels --------------------

function EmptyPanel() {
  return (
    <div className="card animate-fade-in overflow-hidden">
      <div className="relative bg-gradient-to-br from-brand-700 via-brand-800 to-indigo-900 text-white px-8 py-10">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.3), transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.2), transparent 40%)',
        }} />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <div>
            <h3 className="text-2xl font-bold tracking-tight">Claim Validation Portal</h3>
            <p className="text-sm text-white/80 mt-1 max-w-xl">
              An AI-powered analyst for partner marketing (MDF) claims. Enter your claim details, upload
              supporting evidence, and receive a structured validation report in under a minute.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
                <Sparkles className="w-3 h-3" /> Claude AI
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
                <FileCheck className="w-3 h-3" /> Guideline-aware
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
                <Clock className="w-3 h-3" /> ~45 sec
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-body py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="p-5 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white">
            <h4 className="text-sm font-bold text-violet-900 mb-3 flex items-center gap-2">
              <div className="icon-tile w-7 h-7 bg-gradient-to-br from-violet-500 to-violet-700">
                <Upload className="w-4 h-4 text-white" />
              </div>
              What to upload
            </h4>
            <ul className="text-xs text-slate-700 space-y-1.5 pl-1">
              <li>• Invoices and receipts</li>
              <li>• Event photos or screenshots</li>
              <li>• Attendance lists or registrations</li>
              <li>• Signed completion / delivery notes</li>
              <li>• Contracts, quotes, purchase orders</li>
            </ul>
          </div>
          <div className="p-5 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
            <h4 className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2">
              <div className="icon-tile w-7 h-7 bg-gradient-to-br from-emerald-500 to-emerald-700">
                <FileCheck className="w-4 h-4 text-white" />
              </div>
              What gets checked
            </h4>
            <ul className="text-xs text-slate-700 space-y-1.5 pl-1">
              <li>• Monetary amounts reconciled vs. claim</li>
              <li>• Dates align with activity window</li>
              <li>• Partner name and ID consistency</li>
              <li>• Proof of performance present</li>
              <li>• Program guideline compliance</li>
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { Icon: FileSearch,    label: 'Evidence Extraction', tone: 'from-violet-500 to-indigo-600',  bg: 'from-violet-50 to-white',  border: 'border-violet-200' },
            { Icon: BarChart3,     label: 'Field Validation',    tone: 'from-emerald-500 to-teal-600',   bg: 'from-emerald-50 to-white', border: 'border-emerald-200' },
            { Icon: ClipboardList, label: 'Guideline Checks',    tone: 'from-amber-500 to-orange-600',   bg: 'from-amber-50 to-white',   border: 'border-amber-200' },
          ].map(({ Icon, label, tone, bg, border }) => (
            <div key={label} className={clsx('p-4 rounded-xl bg-gradient-to-br text-center border', bg, border)}>
              <div className={clsx('icon-tile mx-auto mb-2 bg-gradient-to-br', tone)}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-xs font-semibold text-slate-800">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingPanel({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="card animate-fade-in">
      <div className="card-body py-12">
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-brand-100 border-t-brand-600 animate-spin" />
            <Sparkles className="w-6 h-6 text-brand-600 absolute inset-0 m-auto" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">Analyzing Your Claim</h3>
          <p className="text-sm text-slate-600 mt-1">This may take 30-60 seconds</p>
        </div>
        <ol className="space-y-3 max-w-md mx-auto">
          {steps.map((s, i) => (
            <li key={s} className={clsx(
              'flex items-center gap-3 p-3 rounded-lg transition-all',
              i < current && 'bg-emerald-50',
              i === current && 'bg-brand-50 ring-1 ring-brand-200',
              i > current && 'bg-slate-50 opacity-60',
            )}>
              {i < current ? <CheckCircle className="w-5 h-5 text-emerald-500" />
                : i === current ? <Loader2 className="w-5 h-5 text-brand-600 animate-spin" />
                : <Clock className="w-5 h-5 text-slate-400" />}
              <span className={clsx('text-sm', i === current ? 'font-semibold text-slate-900' : 'text-slate-600')}>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ResultsPanel({ result, stats, tab, setTab, onViewSummary }: {
  result: ValidationResult;
  stats: { pass: number; fail: number; warn: number; total: number; criticalIssues: number };
  tab: 'overview' | 'fields' | 'documents' | 'guidelines' | 'issues';
  setTab: (t: 'overview' | 'fields' | 'documents' | 'guidelines' | 'issues') => void;
  onViewSummary: () => void;
}) {
  const d = DECISION_STYLES[result.decision];
  const { Icon } = d;

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Decision card */}
      <div className={clsx('rounded-xl border ring-1', d.bg, d.ring, 'p-6')}>
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 p-3 bg-white rounded-xl shadow-sm">
            <Icon className={clsx('w-8 h-8', d.text)} />
          </div>
          <div className="flex-1">
            <div className="flex items-baseline gap-3 mb-1">
              <h2 className={clsx('text-2xl font-bold', d.text)}>{d.label}</h2>
              <span className="text-sm text-slate-600">• Confidence {result.confidence}%</span>
            </div>
            <p className={clsx('text-sm leading-relaxed', d.text)}>{result.summary}</p>
          </div>
          <button onClick={onViewSummary} className="btn-secondary whitespace-nowrap">
            <FileDown className="w-4 h-4" /> View Summary
          </button>
        </div>
        {/* Confidence bar */}
        <div className="mt-4 bg-white/70 rounded-full h-2 overflow-hidden">
          <div className="h-full bg-current rounded-full progress-bar"
            style={{ ['--progress-width' as string]: `${result.confidence}%`, width: `${result.confidence}%` } as React.CSSProperties} />
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Checks Passed" value={stats.pass} total={stats.total} tone="emerald" />
        <StatCard label="Failed / Missing" value={stats.fail} total={stats.total} tone="red" />
        <StatCard label="Warnings" value={stats.warn} total={stats.total} tone="amber" />
        <StatCard label="Critical Issues" value={stats.criticalIssues} tone="orange" />
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="card-header overflow-x-auto">
          <nav className="flex gap-1">
            {([
              ['overview', 'Overview', BarChart3],
              ['fields', `Fields (${result.fieldValidations.length})`, ClipboardList],
              ['documents', `Documents (${result.documentAnalysis.length})`, FileText],
              ['guidelines', `Guidelines (${result.guidelineChecks.length})`, FileCheck],
              ['issues', `Issues (${result.issues.length})`, AlertOctagon],
            ] as const).map(([key, label, I]) => (
              <button key={key} onClick={() => setTab(key)}
                className={clsx('tab-btn flex items-center gap-1.5 whitespace-nowrap', tab === key && 'active')}>
                <I className="w-4 h-4" /> {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="card-body">
          {tab === 'overview' && <OverviewTab result={result} />}
          {tab === 'fields' && <FieldsTab result={result} />}
          {tab === 'documents' && <DocumentsTab result={result} />}
          {tab === 'guidelines' && <GuidelinesTab result={result} />}
          {tab === 'issues' && <IssuesTab result={result} />}
        </div>
      </div>

      <p className="text-xs text-slate-500 text-center">
        Audited {new Date(result.auditTimestamp).toLocaleString()} • {result.processingNotes}
      </p>
    </div>
  );
}

function StatCard({ label, value, total, tone }: { label: string; value: number; total?: number; tone: 'emerald' | 'red' | 'amber' | 'orange' }) {
  const tones = {
    emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-800',
    red:     'bg-gradient-to-br from-red-50 to-red-100 border-red-200 text-red-800',
    amber:   'bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200 text-amber-800',
    orange:  'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 text-orange-800',
  };
  return (
    <div className={clsx('rounded-xl border px-3 py-3 shadow-sm', tones[tone])}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-2xl font-bold mt-0.5 tracking-tight">
        {value}{total !== undefined && <span className="text-sm font-semibold opacity-60"> / {total}</span>}
      </p>
    </div>
  );
}

function OverviewTab({ result }: { result: ValidationResult }) {
  const topIssues = result.issues.slice(0, 4);
  return (
    <div className="space-y-5">
      {result.recommendations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" /> Recommendations
          </h4>
          <ul className="space-y-1.5">
            {result.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <ChevronRight className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {topIssues.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Top Issues</h4>
          <div className="space-y-2">
            {topIssues.map((i, idx) => (
              <div key={idx} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{i.category}</p>
                  <span className={clsx('badge border', SEVERITY_STYLES[i.severity])}>{i.severity.toUpperCase()}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1">{i.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldsTab({ result }: { result: ValidationResult }) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-slate-200">
            <th className="pb-2 font-semibold text-xs uppercase tracking-wider text-slate-500">Field</th>
            <th className="pb-2 font-semibold text-xs uppercase tracking-wider text-slate-500">Submitted</th>
            <th className="pb-2 font-semibold text-xs uppercase tracking-wider text-slate-500">Extracted</th>
            <th className="pb-2 font-semibold text-xs uppercase tracking-wider text-slate-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {result.fieldValidations.map((f, i) => {
            const s = STATUS_STYLES[f.status] ?? STATUS_STYLES.warning;
            return (
              <tr key={i} className="align-top">
                <td className="py-3 pr-4">
                  <p className="font-medium text-slate-800">{f.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{f.note}</p>
                </td>
                <td className="py-3 pr-4 text-slate-700 break-words">{f.submittedValue || '—'}</td>
                <td className="py-3 pr-4 text-slate-700 break-words">{f.extractedValue || '—'}</td>
                <td className="py-3">
                  <span className={clsx('badge border', s.cls)}>
                    <s.Icon className="w-3 h-3" /> {s.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocumentsTab({ result }: { result: ValidationResult }) {
  if (!result.documentAnalysis.length)
    return <p className="text-sm text-slate-500">No documents analyzed.</p>;
  return (
    <div className="space-y-3">
      {result.documentAnalysis.map((d, i) => (
        <div key={i} className="p-4 rounded-lg border border-slate-200">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <h4 className="font-semibold text-slate-900 text-sm">{d.fileName}</h4>
              <p className="text-xs text-slate-500 mt-0.5">Type: {d.type}</p>
            </div>
            <span className={clsx('badge border',
              d.relevance === 'high' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              d.relevance === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-slate-100 text-slate-600 border-slate-200',
            )}>{d.relevance} relevance</span>
          </div>
          <p className="text-sm text-slate-700 mb-3">{d.summary}</p>
          {d.keyDataFound.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Key Data Found</p>
              <ul className="text-xs text-slate-700 space-y-0.5">
                {d.keyDataFound.map((k, j) => <li key={j}>• {k}</li>)}
              </ul>
            </div>
          )}
          {d.issues.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Issues</p>
              <ul className="text-xs text-amber-800 space-y-0.5">
                {d.issues.map((k, j) => <li key={j}>• {k}</li>)}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GuidelinesTab({ result }: { result: ValidationResult }) {
  return (
    <ul className="divide-y divide-slate-100">
      {result.guidelineChecks.map((g, i) => {
        const s = STATUS_STYLES[g.status] ?? STATUS_STYLES.warning;
        return (
          <li key={i} className="py-3 flex items-start gap-3">
            <s.Icon className={clsx('w-5 h-5 flex-shrink-0 mt-0.5',
              g.status === 'pass' ? 'text-emerald-500' :
              g.status === 'fail' ? 'text-red-500' :
              g.status === 'warning' ? 'text-amber-500' :
              g.status === 'partial' ? 'text-blue-500' :
              'text-slate-400',
            )} />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">{g.requirement}</p>
              <p className="text-xs text-slate-600 mt-0.5">{g.detail}</p>
            </div>
            <span className={clsx('badge border', s.cls)}>{s.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

const PRINT_STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pass:    { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
  warning: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  fail:    { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
  info:    { bg: '#f0f9ff', text: '#1e40af', border: '#bfdbfe' },
};
const PRINT_SEV_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
  high:     { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  medium:   { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  low:      { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
  info:     { bg: '#f0f9ff', text: '#1e40af', border: '#bfdbfe' },
};
const PRINT_DECISION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  approved:            { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
  rejected:            { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
  'approved-with-conditions': { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  'needs-review':      { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
};

function PrintBadge({ label, colors }: { label: string; colors: { bg: string; text: string; border: string } }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '9999px',
      fontSize: '10px', fontWeight: 700,
      background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
    }}>{label}</span>
  );
}

function SummaryModal({ claim, result, onClose }: { claim: ClaimFormData; result: ValidationResult; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  const d = DECISION_STYLES[result.decision];
  const handlePrint = () => window.print();
  const dc = PRINT_DECISION_COLORS[result.decision] ?? PRINT_DECISION_COLORS['needs-review'];

  const printReport = (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#1e293b', lineHeight: 1.5, padding: '0' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '16px', marginBottom: '20px' }}>
        <div style={{ fontSize: '22px', fontWeight: 800, color: '#1e293b', marginBottom: '4px' }}>Claim Validation Summary</div>
        <div style={{ fontSize: '11px', color: '#64748b' }}>
          Generated {new Date(result.auditTimestamp).toLocaleString()} · Claim Validation Portal · A project by Govind Amilkanthwar
        </div>
      </div>

      {/* Decision */}
      <div style={{ padding: '14px 16px', borderRadius: '8px', marginBottom: '20px', background: dc.bg, border: `1px solid ${dc.border}`, breakInside: 'avoid' as const }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: dc.text }}>Decision: {d.label}</div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Confidence: {result.confidence}%</div>
        </div>
        <div style={{ fontSize: '12px', color: dc.text }}>{result.summary}</div>
      </div>

      {/* Claim Details */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#475569', marginBottom: '8px' }}>Claim Details</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, border: '1px solid #e2e8f0' }}>
          <tbody>
            {(Object.entries(FIELD_LABELS) as [keyof ClaimFormData, string][]).map(([key, label]) => (
              <tr key={key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 10px', background: '#f8fafc', fontWeight: 600, color: '#475569', width: '35%', fontSize: '11px' }}>{label}</td>
                <td style={{ padding: '6px 10px', color: '#1e293b', fontSize: '11px' }}>{claim[key] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Field Validation */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#475569', marginBottom: '8px' }}>Field Validation</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, border: '1px solid #e2e8f0' }}>
          <thead style={{ display: 'table-header-group' }}>
            <tr style={{ background: '#f8fafc' }}>
              {['Field', 'Submitted', 'Extracted', 'Status'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left' as const, fontSize: '10px', fontWeight: 700, color: '#475569', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.fieldValidations.map((f, i) => {
              const s = STATUS_STYLES[f.status] ?? STATUS_STYLES.warning;
              const sc = PRINT_STATUS_COLORS[f.status] ?? PRINT_STATUS_COLORS.warning;
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1e293b', fontSize: '11px' }}>{f.label}</td>
                  <td style={{ padding: '6px 10px', color: '#475569', fontSize: '11px' }}>{f.submittedValue || '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#475569', fontSize: '11px' }}>{f.extractedValue || '—'}</td>
                  <td style={{ padding: '6px 10px', fontSize: '11px' }}><PrintBadge label={s.label} colors={sc} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Guideline Compliance */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#475569', marginBottom: '8px' }}>Guideline Compliance</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px' }}>
          {result.guidelineChecks.map((g, i) => {
            const s = STATUS_STYLES[g.status] ?? STATUS_STYLES.warning;
            const sc = PRINT_STATUS_COLORS[g.status] ?? PRINT_STATUS_COLORS.warning;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 10px', borderBottom: i < result.guidelineChecks.length - 1 ? '1px solid #f1f5f9' : 'none', breakInside: 'avoid' as const }}>
                <div style={{ flex: 1, marginRight: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#1e293b' }}>{g.requirement}</div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>{g.detail}</div>
                </div>
                <PrintBadge label={s.label} colors={sc} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      {result.issues.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#475569', marginBottom: '8px' }}>Issues Identified</div>
          {result.issues.map((iss, i) => {
            const sc = PRINT_SEV_COLORS[iss.severity] ?? PRINT_SEV_COLORS.medium;
            return (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px', marginBottom: '8px', breakInside: 'avoid' as const }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <PrintBadge label={iss.severity.toUpperCase()} colors={sc} />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>{iss.category}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#475569', marginBottom: '4px' }}>{iss.description}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}><span style={{ fontWeight: 600 }}>Recommendation:</span> {iss.recommendation}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#475569', marginBottom: '8px' }}>Recommendations</div>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {result.recommendations.map((r, i) => (
              <li key={i} style={{ fontSize: '11px', color: '#475569', marginBottom: '4px' }}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', textAlign: 'center' as const, fontSize: '10px', color: '#94a3b8' }}>
        Generated by Claim Validation Portal · A project by Govind Amilkanthwar
      </div>
    </div>
  );

  return (
    <>
      {/* Screen modal — hidden during print */}
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 print:hidden">
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-2xl my-8">
          {/* Toolbar */}
          <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between rounded-t-xl">
            <h2 className="text-base font-bold text-slate-900">Claim Validation Summary</h2>
            <div className="flex items-center gap-2">
              <button onClick={handlePrint} className="btn-secondary"><Printer className="w-4 h-4" /> Print / Save PDF</button>
              <button onClick={onClose} className="btn-secondary"><X className="w-4 h-4" /> Close</button>
            </div>
          </div>

          {/* Screen content */}
          <div className="p-8 space-y-6">
            <div className="text-center border-b border-slate-200 pb-4">
              <h1 className="text-2xl font-bold text-slate-900">Claim Validation Summary</h1>
              <p className="text-xs text-slate-500 mt-1">
                Generated {new Date(result.auditTimestamp).toLocaleString()} · Claim Validation Portal
              </p>
            </div>

            <div className={clsx('rounded-lg border p-5', d.bg, 'border-slate-200')}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={clsx('text-xl font-bold', d.text)}>Decision: {d.label}</h3>
                <span className="text-sm font-semibold text-slate-700">Confidence: {result.confidence}%</span>
              </div>
              <p className={clsx('text-sm leading-relaxed', d.text)}>{result.summary}</p>
            </div>

            <section>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Claim Details</h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {(Object.entries(FIELD_LABELS) as [keyof ClaimFormData, string][]).map(([key, label]) => (
                      <tr key={key}>
                        <td className="py-2 px-3 bg-slate-50 font-medium text-slate-700 w-1/3">{label}</td>
                        <td className="py-2 px-3 text-slate-800">{claim[key] || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Field Validation</h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-xs text-slate-600">Field</th>
                      <th className="text-left py-2 px-3 font-semibold text-xs text-slate-600">Submitted</th>
                      <th className="text-left py-2 px-3 font-semibold text-xs text-slate-600">Extracted</th>
                      <th className="text-left py-2 px-3 font-semibold text-xs text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.fieldValidations.map((f, i) => {
                      const s = STATUS_STYLES[f.status] ?? STATUS_STYLES.warning;
                      return (
                        <tr key={i}>
                          <td className="py-2 px-3 font-medium text-slate-800">{f.label}</td>
                          <td className="py-2 px-3 text-slate-700">{f.submittedValue || '—'}</td>
                          <td className="py-2 px-3 text-slate-700">{f.extractedValue || '—'}</td>
                          <td className="py-2 px-3"><span className={clsx('badge border', s.cls)}>{s.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Guideline Compliance</h3>
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {result.guidelineChecks.map((g, i) => {
                  const s = STATUS_STYLES[g.status] ?? STATUS_STYLES.warning;
                  return (
                    <li key={i} className="py-2 px-3 flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{g.requirement}</p>
                        <p className="text-xs text-slate-600 mt-0.5">{g.detail}</p>
                      </div>
                      <span className={clsx('badge border flex-shrink-0', s.cls)}>{s.label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {result.issues.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Issues Identified</h3>
                <div className="space-y-2">
                  {result.issues.map((iss, i) => (
                    <div key={i} className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={clsx('badge border', SEVERITY_STYLES[iss.severity])}>{iss.severity.toUpperCase()}</span>
                        <p className="text-sm font-semibold text-slate-900">{iss.category}</p>
                      </div>
                      <p className="text-sm text-slate-700 mb-1">{iss.description}</p>
                      <p className="text-xs text-slate-600"><span className="font-semibold">Recommendation:</span> {iss.recommendation}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {result.recommendations.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Recommendations</h3>
                <ul className="space-y-1 pl-5 list-disc text-sm text-slate-700">
                  {result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </section>
            )}

            <div className="border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
              Generated by Claim Validation Portal · A project by Govind Amilkanthwar
            </div>
          </div>
        </div>
      </div>

      {/* Print-only portal — rendered outside #__next so it's the only thing visible when printing */}
      {mounted && createPortal(
        <div id="cvp-print-root">{printReport}</div>,
        document.body
      )}
    </>
  );
}

function IssuesTab({ result }: { result: ValidationResult }) {
  if (!result.issues.length)
    return (
      <div className="text-center py-8">
        <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
        <p className="text-sm font-medium text-slate-800">No issues detected</p>
      </div>
    );
  const order: SeverityType[] = ['critical', 'high', 'medium', 'low', 'info'];
  const sorted = [...result.issues].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <div className="space-y-3">
      {sorted.map((i, idx) => (
        <div key={idx} className="p-4 rounded-lg border border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className={clsx('badge border', SEVERITY_STYLES[i.severity])}>{i.severity.toUpperCase()}</span>
              <p className="text-sm font-semibold text-slate-900">{i.category}</p>
            </div>
          </div>
          <p className="text-sm text-slate-700 mb-2">{i.description}</p>
          <div className="text-xs text-slate-600 bg-slate-50 rounded p-2 border border-slate-100">
            <span className="font-semibold text-slate-700">Recommendation: </span>{i.recommendation}
          </div>
        </div>
      ))}
    </div>
  );
}
