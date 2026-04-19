import type { NextApiRequest, NextApiResponse } from 'next';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import type { ClaimFormData, UploadedDocument, ValidationResult } from '@/lib/types';

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
      if (f.endsWith('.txt')) {
        parts.push(`=== ${f} ===\n${fs.readFileSync(path.join(dir, f), 'utf-8')}`);
      }
    }
  } catch { /* no reference_docs dir */ }
  return parts.length
    ? parts.join('\n\n')
    : 'Apply standard partner MDF claim validation practices.';
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

  const { claimData, documents = [] }: {
    claimData: ClaimFormData;
    documents: UploadedDocument[];
  } = req.body ?? {};

  if (!claimData) return res.status(400).json({ error: 'Missing claimData' });

  const guidelines = loadGuidelines();
  const now = new Date().toISOString();

  const claimBlock = `=== CLAIM SUBMISSION ===
Partner ID: ${claimData.partnerId}
Partner Name: ${claimData.partnerName}
Budget Period: ${claimData.budgetPeriodFrom} to ${claimData.budgetPeriodTo}
Budget Allocation: €${claimData.budgetAllocationAmount}
Category: ${claimData.category}
Request Number: ${claimData.requestNumber}
Activity Type: ${claimData.activityType}
Activity: ${claimData.activity}
Fund Request Submitted: ${claimData.fundRequestSubmittedDate}
Fund Approved Date: ${claimData.fundApprovedDate || 'Not provided'}
Activity Start Date: ${claimData.activityStartDate}
Activity End Date: ${claimData.activityEndDate}
Funding Approved: €${claimData.fundingApproved}
=== END CLAIM ===`;

  const instructionBlock = `
=== SOURCE GUIDELINES ===
${guidelines}
=== END GUIDELINES ===

=== VALIDATION TASK ===
Analyze the claim submission against all provided evidence documents and the guidelines above.
Return ONLY valid JSON — no markdown fences, no extra text outside the JSON object.

{
  "decision": "APPROVED" | "REJECTED" | "NEEDS_REVIEW",
  "confidence": <0-100>,
  "summary": "<2-3 sentence executive summary>",
  "fieldValidations": [
    {"field":"partnerId","label":"Partner ID","submittedValue":"...","extractedValue":"...","status":"pass|fail|warning|missing|partial","note":"..."},
    {"field":"partnerName","label":"Partner Name","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"budgetAllocationAmount","label":"Budget Allocation","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"requestNumber","label":"Request Number","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activityStartDate","label":"Activity Start Date","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activityEndDate","label":"Activity End Date","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"fundingApproved","label":"Funding Approved","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"category","label":"Category","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activityType","label":"Activity Type","submittedValue":"...","extractedValue":"...","status":"...","note":"..."},
    {"field":"activity","label":"Activity Description","submittedValue":"...","extractedValue":"...","status":"...","note":"..."}
  ],
  "documentAnalysis": [
    {"fileName":"...","type":"Invoice|Receipt|Attendance|Photo|Contract|Quote|Other","summary":"...","keyDataFound":["..."],"issues":["..."],"relevance":"high|medium|low"}
  ],
  "guidelineChecks": [
    {"requirement":"Invoice with invoice number present","status":"pass|fail|warning|missing|partial","detail":"..."},
    {"requirement":"Partner identification on documents","status":"...","detail":"..."},
    {"requirement":"Monetary amounts reconciled","status":"...","detail":"..."},
    {"requirement":"Activity dates confirmed in evidence","status":"...","detail":"..."},
    {"requirement":"Proof of performance provided","status":"...","detail":"..."},
    {"requirement":"Currency consistency throughout","status":"...","detail":"..."},
    {"requirement":"Funding does not exceed budget allocation","status":"...","detail":"..."},
    {"requirement":"All required document types present","status":"...","detail":"..."}
  ],
  "issues": [
    {"severity":"critical|high|medium|low|info","category":"...","description":"...","recommendation":"..."}
  ],
  "recommendations": ["..."],
  "auditTimestamp": "${now}",
  "processingNotes": "Analyzed ${documents.length} document(s) against program guidelines."
}

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
      max_tokens: 4096,
      system: 'You are a senior claims validation analyst. Return only valid JSON — no markdown, no prose outside the JSON.',
      messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Claude response');

    const result: ValidationResult = JSON.parse(match[0]);
    result.auditTimestamp = now;
    return res.status(200).json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[validate]', msg);
    return res.status(500).json({ error: msg });
  }
}
