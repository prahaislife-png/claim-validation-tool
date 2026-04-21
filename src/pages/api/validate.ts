import type { NextApiRequest, NextApiResponse } from 'next';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import type { ClaimFormData, UploadedDocument, ValidationResult, AiIntelligenceAnswer } from '@/lib/types';
import { verifyUser } from '@/lib/supabaseAdmin';

function fallbackAiAnswer(result: ValidationResult): AiIntelligenceAnswer {
  const critical = result.issues.filter(i => i.severity === 'critical').length;
  const gFails   = result.guidelineChecks.filter(g => g.status === 'fail' || g.status === 'missing').length;
  const fFails   = result.fieldValidations.filter(f => f.status === 'fail').length;
  const fMissing = result.fieldValidations.filter(f => f.status === 'missing').length;
  const high     = result.issues.filter(i => i.severity === 'high').length;

  let recommendation: AiIntelligenceAnswer['recommendation'];
  if (result.decision === 'REJECTED' || critical > 0 || gFails >= 2 || fFails >= 3) {
    recommendation = 'Reject';
  } else if (result.decision === 'APPROVED' && high === 0 && gFails === 0 && fFails === 0 && fMissing === 0) {
    recommendation = 'Approve';
  } else {
    recommendation = 'Hold';
  }
  return {
    recommendation,
    reason: recommendation === 'Approve'
      ? 'Evidence aligns well with the claim. Looks good to approve.'
      : recommendation === 'Reject'
        ? 'Critical gaps or contradictions found. Cannot approve without resolution.'
        : 'Mostly solid, but a couple of things need a quick manual check before approving.',
  };
}

async function computeAiIntelligenceAnswer(
  result: ValidationResult,
  claimData: ClaimFormData,
  client: Anthropic,
): Promise<AiIntelligenceAnswer> {
  const issueLines = result.issues.length
    ? result.issues.map(i => `- [${i.severity}] ${i.category}: ${i.description}`).join('\n')
    : '- None';

  const failedGuidelines = result.guidelineChecks
    .filter(g => g.status === 'fail' || g.status === 'missing')
    .map(g => `- ${g.requirement}: ${g.detail}`)
    .join('\n') || '- None';

  const prompt = `You are a senior MDF claims analyst with deep knowledge of the SAP partner ecosystem and the enterprise software industry. You give final advisory opinions that combine structured report findings with your real-world knowledge of the partner company.

=== CLAIM REPORT ===
Partner: ${claimData.partnerName}
Activity: ${claimData.activity} | Category: ${claimData.category}
Funds Requested: €${claimData.budgetAllocationAmount}
Report decision: ${result.decision} | Confidence: ${result.confidence}%
Report summary: ${result.summary}

Issues found:
${issueLines}

Failed guideline requirements:
${failedGuidelines}
=== END REPORT ===

Your task: Give a final advisory recommendation on this claim.

Draw on your knowledge of ${claimData.partnerName} — who they are in the market, their reputation, how long they have been operating, their standing in the SAP ecosystem or relevant industry, and whether there are any known concerns about their practices.

Then combine that external perspective with the report findings to decide: Approve, Hold, or Reject.

Rules for your recommendation:
- If the company is reputable and the claim evidence is mostly solid (even with minor FX / formatting issues), lean toward Approve.
- Use Hold only when you genuinely need one specific manual check (e.g. FX rate verification) before it is safe to approve.
- Use Reject only if there are real red flags — missing critical evidence, known bad-actor behavior, or outright contradictions.

Tone: casual and direct, like a colleague giving a quick opinion. E.g. "s-peers AG is a solid SAP partner in Switzerland — approve this. Just get the FX rate documented." Do NOT use bullet points or formal report language.

Respond with ONLY valid JSON, no other text:
{"recommendation":"Approve"|"Reject"|"Hold","reason":"your 1–2 sentence casual opinion, max 70 words"}`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON');
    const parsed = JSON.parse(match[0]);
    if (!['Approve', 'Reject', 'Hold'].includes(parsed.recommendation)) throw new Error('bad recommendation');
    return {
      recommendation: parsed.recommendation as AiIntelligenceAnswer['recommendation'],
      reason: String(parsed.reason ?? '').slice(0, 600),
    };
  } catch {
    return fallbackAiAnswer(result);
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '50mb' },
    responseLimit: '50mb',
  },
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function loadGuidelines(): string {
  const dir = path.join(process.cwd(), 'reference_docs');
  const parts: string[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      if (f.endsWith('.txt')) {
        parts.push(`=== ${f} ===\n${fs.readFileSync(fullPath, 'utf-8')}`);
      } else if (f.endsWith('.xlsx') || f.endsWith('.xls')) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const XLSX = require('xlsx') as typeof import('xlsx');
          const wb = XLSX.readFile(fullPath);
          // Only load the authoritative sheets — the full workbook is 200KB+ of
          // historical/working data that bloats the prompt without adding value.
          const KEY_SHEETS = new Set([
            'Summary',
            '2026 DF CS AH DEMO Load Nov 28',
            '2026 SAP Solution Field Values',
            'FY26 Avtivity Summary',
          ]);
          const sheets = wb.SheetNames
            .filter(n => KEY_SHEETS.has(n))
            .map(n => {
              const rows = XLSX.utils.sheet_to_csv(wb.Sheets[n]).split('\n').slice(0, 200).join('\n');
              return `[Sheet: ${n}]\n${rows}`;
            }).join('\n\n');
          parts.push(`=== ${f} ===\n${sheets}`);
        } catch { /* skip unreadable xlsx */ }
      }
    }
  } catch { /* no reference_docs dir */ }
  return parts.length
    ? parts.join('\n\n')
    : 'Apply standard partner MDF claim validation practices.';
}

async function fetchLiveFxRates(): Promise<string> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { base: string; date: string; rates: Record<string, number> };
    const lines = Object.entries(data.rates).map(([cur, rate]) => `1 ${data.base} = ${rate} ${cur}`);
    return `Live FX Rates (ECB via Frankfurter, ${data.date}):\n${lines.join('\n')}`;
  } catch {
    return 'Live FX rates unavailable — use approximate market rates if needed.';
  }
}

async function toText(doc: UploadedDocument): Promise<string> {
  const ext = doc.name.split('.').pop()?.toLowerCase() ?? '';
  try {
    const buf = Buffer.from(doc.content, 'base64');
    if (['docx', 'doc'].includes(ext)) {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ buffer: buf })).value;
    }
    if (['xlsx', 'xls'].includes(ext)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      return wb.SheetNames.map(n =>
        `[Sheet: ${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`
      ).join('\n\n');
    }
    return buf.toString('utf-8');
  } catch {
    return `[Could not extract text from ${doc.name}]`;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not set. Add it to Vercel Environment Variables.',
    });
  }

  // Auth check — reject unauthenticated requests
  const token = req.headers.authorization?.replace('Bearer ', '');
  const auth  = token ? await verifyUser(token) : null;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const { claimData, documents = [] }: {
    claimData: ClaimFormData;
    documents: UploadedDocument[];
  } = req.body ?? {};

  if (!claimData) return res.status(400).json({ error: 'Missing claimData' });

  const guidelines = loadGuidelines();
  const fxRates = await fetchLiveFxRates();
  const now = new Date().toISOString();

  const claimBlock = `=== CLAIM SUBMISSION ===
Partner Name: ${claimData.partnerName}
Funds Requested: €${claimData.budgetAllocationAmount}
DF Category: ${claimData.category}
Request Number: ${claimData.requestNumber}
Activity Type: ${claimData.activityType}
Activity: ${claimData.activity}
Primary SAP Solution: ${claimData.primarySapSolution || 'Not provided'}
Fund Request Submitted: ${claimData.fundRequestSubmittedDate}
Activity Start Date: ${claimData.activityStartDate}
Activity End Date: ${claimData.activityEndDate}
=== END CLAIM ===`;

  const instructionBlock = `
=== SOURCE GUIDELINES ===
${guidelines}
=== END GUIDELINES ===

=== LIVE FX RATES ===
${fxRates}
=== END FX RATES ===

CURRENCY CONVERSION RULES:
- If the claim currency and invoice currency differ, use the live rates above to convert and compare amounts.
- A converted amount difference of ≤5% is ACCEPTABLE: mark "Currency consistency" as "pass" and do NOT flag as an issue.
- A difference of >5% should be a "warning" (never "critical" or "high"): add a low-severity issue and mark "Currency consistency" as "warning".
- If the amounts match within 5% after conversion, conclude the claim is consistent and keep it green.

=== VALIDATION TASK ===
Analyze the claim submission against all provided evidence documents and the guidelines above.
Return ONLY valid JSON — no markdown fences, no extra text outside the JSON object.

{
  "decision": "APPROVED" | "REJECTED" | "NEEDS_REVIEW",
  "confidence": <0-100>,
  "summary": "<2-3 sentence executive summary — do not mention Partner ID>",
  "fieldValidations": [
    {"field":"partnerName","label":"Partner Name","submittedValue":"...","extractedValue":"...","status":"pass|fail|warning|missing|partial","note":"..."},
    {"field":"budgetAllocationAmount","label":"Funds Requested","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"requestNumber","label":"Request Number","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activityStartDate","label":"Activity Start Date","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activityEndDate","label":"Activity End Date","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"category","label":"DF Category","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activityType","label":"Activity Type","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activity","label":"Activity","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"primarySapSolution","label":"Primary SAP Solution","submittedValue":"...","extractedValue":"...","status":"...","note":"..."}
  ],
  "documentAnalysis": [
    {"fileName":"...","type":"Invoice|Receipt|Attendance|Photo|Contract|Quote|Other","summary":"...","keyDataFound":["..."],"issues":["..."],"relevance":"high|medium|low"}
  ],
  "guidelineChecks": [
    {"requirement":"Third party invoice confirmation to program guidelines","status":"pass|fail|warning|missing|partial","detail":"..."},
    {"requirement":"Partner invoices confirmation to program guidelines","status":"...","detail":"..."},
    {"requirement":"Proof of performance confirmation to program guidelines","status":"...","detail":"..."},
    {"requirement":"DF Category / Activity Type / Activity alignment with SAP DF Activity Hierarchy V10","status":"...","detail":"..."},
    {"requirement":"Partner identification on documents","status":"...","detail":"..."},
    {"requirement":"Monetary amounts reconciled","status":"...","detail":"..."},
    {"requirement":"Activity dates confirmed in evidence","status":"...","detail":"..."},
    {"requirement":"Currency consistency throughout","status":"...","detail":"..."},
    {"requirement":"Funds requested amount supported by invoice totals","status":"...","detail":"..."},
    {"requirement":"All required document types present","status":"...","detail":"..."}
  ],
  "issues": [
    {"severity":"critical|high|medium|low|info","category":"...","description":"...","recommendation":"..."}
  ],
  "recommendations": ["..."],
  "auditTimestamp": "${now}",
  "processingNotes": "Analyzed ${documents.length} document(s) against program guidelines.",
  "documentAuthenticity": {
    "overallRiskLevel": "Low|Medium|High",
    "overallConfidence": "Low|Medium|High",
    "overallConclusion": "<neutral summary — e.g. 'no strong authenticity concerns detected' or 'possible tampering signals detected'>",
    "files": [
      {
        "fileName": "<exact filename from submission>",
        "riskLevel": "Low|Medium|High",
        "confidence": "Low|Medium|High",
        "conclusion": "<neutral one-sentence conclusion>",
        "evidence": [
          {"strength": "weak|moderate|strong", "description": "<specific observed signal>"}
        ],
        "limitations": "<short note on what could not be assessed>"
      }
    ]
  }
}

DOCUMENT AUTHENTICITY ANALYSIS INSTRUCTIONS:
For each uploaded file assess the following signals:
- WEAK signals (small contribution): suspicious filename suffixes such as _edited, v2, copy, final, scan alone; minor whitespace inconsistency
- MODERATE signals (medium contribution): single inconsistent font or spacing; one data field mismatch (date, total, VAT)
- STRONG signals (high contribution): multiple corroborated visual inconsistencies; overlaid or pasted text visible; altered numbers with mismatched formatting; inconsistent compression artefacts in image regions; mismatched vendor name/address/logo across related documents; duplicate invoice numbers that should be independent

SCORING RULES:
- A filename containing "_edited" is ONE weak signal — it alone cannot produce Medium or High risk.
- Only classify as High risk when two or more STRONG signals corroborate each other.
- Never state "forged", "fake", or "manipulated" unless multiple strong corroborating signals are present.
- Prefer wording: "possible tampering signals detected", "editing indicators present", "no strong authenticity concerns detected", "insufficient evidence to determine".
- If there are no signals at all, conclude "no strong authenticity concerns detected" with Low risk.

Decision rules:
- APPROVED: critical fields verified, evidence complete, no critical/high issues.
- NEEDS_REVIEW: minor discrepancies, partial evidence, or medium issues.
- REJECTED: amount mismatches, missing critical evidence, or policy violations.
=== END TASK ===`;

  try {
    type Block =
      | Anthropic.TextBlockParam
      | Anthropic.ImageBlockParam
      | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string };

    const content: Block[] = [{ type: 'text', text: claimBlock }];

    for (const doc of documents) {
      if (doc.type === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: doc.content },
          title: doc.name,
        });
      } else if (doc.type.startsWith('image/')) {
        const mt = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(doc.type)
          ? doc.type
          : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: doc.content } });
        content.push({ type: 'text', text: `[Above image filename: ${doc.name}]` });
      } else {
        const text = doc.isText ? doc.content : await toText(doc);
        content.push({ type: 'text', text: `[DOCUMENT: ${doc.name}]\n${text}\n[END DOCUMENT]` });
      }
    }

    content.push({ type: 'text', text: instructionBlock });

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16384,
      system: 'You are a senior claims validation analyst. Return only valid JSON — no markdown, no prose outside the JSON.',
      messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    if (!raw) throw new Error('Empty response from Claude');
    if (response.stop_reason === 'max_tokens') {
      console.error('[validate] Claude response hit max_tokens — JSON may be truncated');
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Claude response');

    const result: ValidationResult = JSON.parse(match[0]);
    result.auditTimestamp = now;
    result.aiIntelligenceAnswer = await computeAiIntelligenceAnswer(result, claimData, anthropic);

    // Persist submission + activity log (non-blocking)
    auth.adminClient.from('claim_submissions').insert({
      user_id:        auth.user.id,
      email:          auth.profile.email,
      partner_id:     null,
      partner_name:   claimData.partnerName,
      request_number: claimData.requestNumber,
      claim_data:     claimData,
      document_count: documents.length,
      decision:       result.decision,
      confidence:     result.confidence,
    }).then(() => {});

    auth.adminClient.from('activity_logs').insert({
      user_id:  auth.user.id,
      email:    auth.profile.email,
      action:   'claim_submission',
      metadata: {
        partner_name: claimData.partnerName,
        decision:     result.decision,
        confidence:   result.confidence,
        doc_count:    documents.length,
      },
    }).then(() => {});

    return res.status(200).json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[validate]', msg);
    return res.status(500).json({ error: msg });
  }
}
