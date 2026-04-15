const form = document.getElementById('claim-form');
const resultsPanel = document.getElementById('results');
const auditPill = document.getElementById('audit-pill');
const generatedAt = document.getElementById('generatedAt');

const sectionIds = {
  claimInputs: 'claim-inputs',
  docSummary: 'doc-summary',
  extractedData: 'extracted-data',
  matchingAnalysis: 'matching-analysis',
  guidelineAnalysis: 'guideline-analysis',
  aiScreening: 'ai-screening',
  overallSummary: 'overall-summary'
};

const REFERENCE_INDEX_PATH = 'reference_docs/index.json';
const MAX_TEXT_READ_BYTES = 400_000;

function severityTag(level) {
  return `<span class="severity ${level}">${level}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toCurrency(value, currency = 'USD') {
  const number = Number(value);
  if (Number.isNaN(number)) return 'N/A';
  return number.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2 });
}

function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseMoney(value) {
  if (!value && value !== 0) return null;
  const normalized = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

function parseDateCandidates(text) {
  const matches = text.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/g) || [];
  return [...new Set(matches)].slice(0, 5);
}

function parseInvoiceCandidates(text) {
  const regex = /\b(?:invoice\s*(?:no|number)?[:\-\s]*)?([A-Z]{1,4}-?\d{3,10})\b/gi;
  const values = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    values.push(match[1].toUpperCase());
  }
  return [...new Set(values)].slice(0, 5);
}

function parseCurrencyCandidates(text) {
  const found = [];
  if (/\bUSD\b|\$/i.test(text)) found.push('USD');
  if (/\bEUR\b|€/i.test(text)) found.push('EUR');
  if (/\bGBP\b|£/i.test(text)) found.push('GBP');
  if (/\bINR\b|₹/i.test(text)) found.push('INR');
  return [...new Set(found)];
}

function parseAmountCandidates(text) {
  const regex = /(?:total|grand total|net|vat|tax|amount)\s*[:\-]?\s*([$€£₹]?\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?)/gi;
  const values = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parseMoney(match[1]);
    if (parsed !== null) values.push(parsed);
  }
  return values.slice(0, 12);
}

function detectProofIndicators(text) {
  const indicators = [];
  const keywordMap = [
    ['delivery', 'Delivery note reference found'],
    ['completion', 'Completion wording present'],
    ['signed', 'Signed evidence detected'],
    ['photo', 'Photo/visual proof mention found'],
    ['timesheet', 'Timesheet mention found'],
    ['attendance', 'Attendance evidence mention found']
  ];

  keywordMap.forEach(([term, label]) => {
    if (text.includes(term)) indicators.push(label);
  });

  return indicators;
}

async function readTextSnippet(file) {
  const isReadableAsText = /text|json|csv|xml/.test(file.type) || /\.(txt|csv|json|xml|md)$/i.test(file.name);
  if (!isReadableAsText) return '';

  try {
    const text = await file.text();
    return text.slice(0, MAX_TEXT_READ_BYTES).toLowerCase();
  } catch (_error) {
    return '';
  }
}

async function extractFromUploadedDocuments(files, enteredPartnerName) {
  const summary = {
    partnerNames: new Set(),
    invoiceNumbers: new Set(),
    invoiceDates: new Set(),
    vendorNames: new Set(),
    requestApprovalNumbers: new Set(),
    amountCandidates: [],
    currencies: new Set(),
    activityDescriptionHints: [],
    proofIndicators: new Set(),
    lowReadabilityFiles: []
  };

  summary.partnerNames.add(enteredPartnerName);

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    const basename = lowerName.replace(/\.[^/.]+$/, '');

    summary.vendorNames.add(basename.replace(/[_-]/g, ' ').slice(0, 80));

    const requestMatch = basename.match(/(?:req|request|approval|po)[-_ ]?(\d{3,12})/i);
    if (requestMatch) summary.requestApprovalNumbers.add(requestMatch[0].toUpperCase());

    const text = await readTextSnippet(file);
    if (!text) {
      summary.lowReadabilityFiles.push(file.name);
      continue;
    }

    parseInvoiceCandidates(text).forEach((item) => summary.invoiceNumbers.add(item));
    parseDateCandidates(text).forEach((item) => summary.invoiceDates.add(item));
    parseAmountCandidates(text).forEach((item) => summary.amountCandidates.push(item));
    parseCurrencyCandidates(text).forEach((item) => summary.currencies.add(item));
    detectProofIndicators(text).forEach((item) => summary.proofIndicators.add(item));

    const partnerMatch = text.match(/(?:partner|client|customer|vendor)\s*[:\-]\s*([a-z0-9 .,&-]{3,80})/i);
    if (partnerMatch?.[1]) summary.partnerNames.add(partnerMatch[1].trim());

    const activityMatch = text.match(/(?:activity|description|scope)\s*[:\-]\s*([a-z0-9 .,&-]{8,120})/i);
    if (activityMatch?.[1]) summary.activityDescriptionHints.push(activityMatch[1].trim());
  }

  const sortedAmounts = summary.amountCandidates.filter((n) => Number.isFinite(n)).sort((a, b) => b - a);
  const totalAmount = sortedAmounts[0] ?? null;
  const netAmount = sortedAmounts.find((n) => n < (totalAmount ?? Number.MAX_SAFE_INTEGER)) ?? null;
  const vatAmount = totalAmount !== null && netAmount !== null ? Math.max(totalAmount - netAmount, 0) : null;

  return {
    partnerNames: [...summary.partnerNames],
    invoiceNumber: [...summary.invoiceNumbers][0] ?? 'Not clearly extracted',
    invoiceDate: [...summary.invoiceDates][0] ?? 'Not clearly extracted',
    vendorName: [...summary.vendorNames][0] ?? 'Not clearly extracted',
    requestApprovalNumber: [...summary.requestApprovalNumbers][0] ?? 'Not found',
    netAmount,
    vat: vatAmount,
    totalAmount,
    allAmountCandidates: sortedAmounts.slice(0, 6),
    currency: [...summary.currencies][0] ?? 'USD',
    currenciesDetected: [...summary.currencies],
    activityDescription:
      summary.activityDescriptionHints[0] ?? 'Activity description could not be reliably extracted from current files.',
    proofOfPerformance: [...summary.proofIndicators],
    lowReadabilityFiles: summary.lowReadabilityFiles
  };
}

async function loadGuidelineDocs() {
  try {
    const indexResponse = await fetch(REFERENCE_INDEX_PATH);
    if (!indexResponse.ok) {
      return { docs: [], status: 'Reference index not found. Add reference_docs/index.json to enable full guideline mapping.' };
    }

    const indexData = await indexResponse.json();
    if (!Array.isArray(indexData.documents) || indexData.documents.length === 0) {
      return { docs: [], status: 'Reference index loaded, but no guideline documents are listed yet.' };
    }

    const docs = await Promise.all(
      indexData.documents.map(async (doc) => {
        const response = await fetch(doc.path);
        if (!response.ok) {
          return { ...doc, content: '', loaded: false };
        }
        const content = (await response.text()).toLowerCase();
        return { ...doc, content, loaded: true };
      })
    );

    const loaded = docs.filter((doc) => doc.loaded).length;
    const status =
      loaded === docs.length
        ? `Loaded ${loaded} guideline document(s).`
        : `Loaded ${loaded}/${docs.length} guideline document(s).`;

    return { docs, status };
  } catch (_error) {
    return { docs: [], status: 'Unable to load guideline documents in this environment.' };
  }
}

function buildGuidelineFindings(extracted, guidelinePayload, filesCount) {
  const docs = guidelinePayload.docs;

  if (!docs.length) {
    return {
      guidelineLines: [
        `${severityTag('medium')} Document completeness observation: ${filesCount < 2 ? 'supporting evidence set appears limited' : 'core claim documents appear present'}`,
        `${severityTag('low')} Invoice structure observation: base invoice fields were checked from uploaded metadata and readable text snippets`,
        `${severityTag('medium')} Proof-of-performance observation: ${extracted.proofOfPerformance.length ? extracted.proofOfPerformance.join('; ') : 'No explicit proof indicators were extracted'}`,
        `${severityTag('medium')} Missing support indicators: reference guideline files are not configured, so only generic checks could run`,
        `${severityTag('low')} Claim documentation notes: ${guidelinePayload.status}`
      ],
      guidelineStatus: guidelinePayload.status
    };
  }

  const corpus = docs.map((doc) => doc.content || '').join('\n');
  const needsInvoice = corpus.includes('invoice');
  const needsPof = corpus.includes('proof') || corpus.includes('delivery') || corpus.includes('completion');
  const needsVat = corpus.includes('vat') || corpus.includes('tax');

  const completenessIssues = [];
  if (needsInvoice && extracted.invoiceNumber === 'Not clearly extracted') completenessIssues.push('Invoice number not clearly extracted');
  if (needsPof && extracted.proofOfPerformance.length === 0) completenessIssues.push('No proof-of-performance indicator extracted');
  if (needsVat && extracted.vat === null) completenessIssues.push('VAT/Tax details could not be derived from readable content');

  return {
    guidelineLines: [
      `${severityTag(completenessIssues.length ? 'medium' : 'low')} Document completeness observation: ${completenessIssues.length ? completenessIssues.join('; ') : 'Core checklist indicators from guideline docs were observed'}`,
      `${severityTag('low')} Invoice structure observation: ${extracted.invoiceNumber === 'Not clearly extracted' ? 'Invoice structure appears incomplete in readable content' : 'Invoice number pattern and date markers were detected'}`,
      `${severityTag(extracted.proofOfPerformance.length ? 'low' : 'medium')} Proof-of-performance observation: ${extracted.proofOfPerformance.length ? extracted.proofOfPerformance.join('; ') : 'No clear proof language extracted from readable sections'}`,
      `${severityTag(completenessIssues.length > 1 ? 'high' : 'medium')} Missing support indicators: ${completenessIssues.length ? completenessIssues.join('; ') : 'No major missing-support indicators detected from available checks'}`,
      `${severityTag('low')} Claim documentation notes based on uploaded guide documents: ${guidelinePayload.status}`
    ],
    guidelineStatus: guidelinePayload.status
  };
}

function renderList(items) {
  if (!items.length) return '<p class="empty">No data available.</p>';
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function classifyAmountMatch(claimedAmount, extractedTotal) {
  if (extractedTotal === null) return { state: 'unclear totals', diff: null };
  const diff = Math.abs(claimedAmount - extractedTotal);
  if (diff < 0.01) return { state: 'exact match', diff };
  if (diff <= Math.max(50, claimedAmount * 0.05)) return { state: 'partial match', diff };
  return { state: 'mismatch', diff };
}

function partnerMatchState(entered, extractedNames) {
  const normalizedEntered = normalizeName(entered);
  const normalizedExtracted = extractedNames.map(normalizeName);

  if (normalizedExtracted.includes(normalizedEntered)) return 'exact match';
  if (normalizedExtracted.some((name) => name.includes(normalizedEntered) || normalizedEntered.includes(name))) {
    return 'partial match';
  }
  return 'mismatch';
}

function buildAiScreeningFindings(extracted, files) {
  const findings = [];

  findings.push(`${severityTag('medium')} possible anomaly detected: ${extracted.lowReadabilityFiles.length ? `${extracted.lowReadabilityFiles.length} file(s) have low machine readability, increasing review uncertainty` : 'no major readability anomalies in text-readable files'}`);

  const duplicateInvoice = extracted.invoiceNumber !== 'Not clearly extracted' && files.filter((file) => file.name.toUpperCase().includes(extracted.invoiceNumber)).length > 1;
  findings.push(`${severityTag(duplicateInvoice ? 'high' : 'low')} duplicate invoice number detection: ${duplicateInvoice ? 'possible overlap across file names detected' : 'no duplicate pattern observed from current file set'}`);

  const hasCurrencyInconsistency = extracted.currenciesDetected.length > 1;
  findings.push(`${severityTag(hasCurrencyInconsistency ? 'high' : 'medium')} metadata inconsistency: ${hasCurrencyInconsistency ? `multiple currencies detected (${extracted.currenciesDetected.join(', ')})` : 'single/unclear currency marker in available content'}`);

  const vatUnexpected = extracted.totalAmount !== null && extracted.netAmount !== null && extracted.vat !== null
    ? Math.abs((extracted.netAmount + extracted.vat) - extracted.totalAmount) > 1
    : true;

  findings.push(`${severityTag(vatUnexpected ? 'medium' : 'low')} VAT/math inconsistencies: ${vatUnexpected ? 'recomputed totals need manual confirmation' : 'math checks appear internally consistent in extracted values'}`);

  findings.push(`${severityTag('medium')} formatting inconsistency: layout/font/spacing analysis is heuristic only in MVP and requires manual document review for confirmation`);

  return findings;
}

function renderResults({ partnerName, claimedAmount, files, extracted, guidelineFindings }) {
  const uploadedNames = files.map(
    (file) => `${escapeHtml(file.name)} (${Math.max(1, Math.round(file.size / 1024))} KB · ${file.type || 'unknown type'})`
  );

  const claimedAmountFormatted = toCurrency(claimedAmount, extracted.currency || 'USD');
  const extractedTotalFormatted = extracted.totalAmount === null ? 'Not clearly extracted' : toCurrency(extracted.totalAmount, extracted.currency);

  const partnerMatch = partnerMatchState(partnerName, extracted.partnerNames);
  const amountMatch = classifyAmountMatch(claimedAmount, extracted.totalAmount);
  const amountSeverity = amountMatch.state === 'mismatch' ? 'high' : amountMatch.state === 'partial match' ? 'medium' : 'low';
  const partnerSeverity = partnerMatch === 'mismatch' ? 'high' : partnerMatch === 'partial match' ? 'medium' : 'low';

  document.getElementById(sectionIds.claimInputs).innerHTML = `
    <h3>Claim Inputs</h3>
    ${renderList([
      `Partner Name (entered): <strong>${escapeHtml(partnerName)}</strong>`,
      `Claimed Amount (entered): <strong>${claimedAmountFormatted}</strong>`
    ])}
  `;

  document.getElementById(sectionIds.docSummary).innerHTML = `
    <h3>Uploaded Documents Summary</h3>
    ${renderList(uploadedNames)}
    <p><strong>Total files:</strong> ${files.length}</p>
    <p><strong>Readability note:</strong> ${
      extracted.lowReadabilityFiles.length
        ? `${extracted.lowReadabilityFiles.length} file(s) are binary/image-like and only metadata checks were run.`
        : 'All uploaded files provided at least minimal readable text.'
    }</p>
  `;

  document.getElementById(sectionIds.extractedData).innerHTML = `
    <h3>Extracted Data</h3>
    ${renderList([
      `Partner Names: ${escapeHtml(extracted.partnerNames.join(', '))}`,
      `Invoice Number: ${escapeHtml(extracted.invoiceNumber)}`,
      `Invoice Date: ${escapeHtml(extracted.invoiceDate)}`,
      `Vendor Name: ${escapeHtml(extracted.vendorName)}`,
      `Request/Approval Number: ${escapeHtml(extracted.requestApprovalNumber)}`,
      `Net Amount: ${extracted.netAmount === null ? 'Not clearly extracted' : toCurrency(extracted.netAmount, extracted.currency)}`,
      `VAT: ${extracted.vat === null ? 'Not clearly extracted' : toCurrency(extracted.vat, extracted.currency)}`,
      `Total Amount: ${extractedTotalFormatted}`,
      `Currency: ${escapeHtml(extracted.currency)}`,
      `Activity Description: ${escapeHtml(extracted.activityDescription)}`,
      `Proof-of-Performance Indicators: ${
        extracted.proofOfPerformance.length ? escapeHtml(extracted.proofOfPerformance.join('; ')) : 'None confidently extracted'
      }`
    ])}
  `;

  document.getElementById(sectionIds.matchingAnalysis).innerHTML = `
    <h3>Matching Analysis</h3>
    ${renderList([
      `${severityTag(partnerSeverity)} Extracted partner names vs entered partner name: ${partnerMatch}`,
      `${severityTag(amountSeverity)} Extracted total amount (${extractedTotalFormatted}) vs entered claimed amount (${claimedAmountFormatted}): ${amountMatch.state}`,
      `${severityTag(extracted.allAmountCandidates.length > 1 ? 'medium' : 'low')} Multiple totals found: ${
        extracted.allAmountCandidates.length > 1
          ? extracted.allAmountCandidates.map((amount) => toCurrency(amount, extracted.currency)).join(', ')
          : 'No multiple total candidates detected'
      }`,
      `${severityTag(amountMatch.state === 'unclear totals' ? 'high' : 'low')} Unclear totals: ${amountMatch.state === 'unclear totals' ? 'Readable content did not expose a reliable total amount' : 'Total amount candidate identified'}`,
      `${severityTag(extracted.currenciesDetected.length > 1 ? 'high' : 'low')} Currency inconsistencies: ${
        extracted.currenciesDetected.length > 1
          ? `multiple currencies detected (${escapeHtml(extracted.currenciesDetected.join(', '))})`
          : 'no obvious cross-currency entries detected'
      }`,
      `${severityTag(extracted.requestApprovalNumber === 'Not found' ? 'medium' : 'low')} Missing financial fields: request/approval number ${extracted.requestApprovalNumber === 'Not found' ? 'not found' : 'found'}`
    ])}
  `;

  document.getElementById(sectionIds.guidelineAnalysis).innerHTML = `
    <h3>Guideline Analysis</h3>
    ${renderList(guidelineFindings.guidelineLines)}
  `;

  document.getElementById(sectionIds.aiScreening).innerHTML = `
    <h3>AI Screening (Advisory Only)</h3>
    ${renderList(buildAiScreeningFindings(extracted, files))}
    <p class="disclaimer">
      Disclaimer: AI Screening is an advisory indicator engine only. It does not prove fraud, forgery, or authenticity,
      and all findings require manual review.
    </p>
  `;

  document.getElementById(sectionIds.overallSummary).innerHTML = `
    <h3>Overall Summary</h3>
    ${renderList([
      `${severityTag('medium')} Neutral assessment generated from uploaded files, file metadata, and text-readable extraction heuristics`,
      `${severityTag('medium')} Manual review recommended for highlighted matching/guideline/AI indicators`,
      `${severityTag('low')} This MVP provides analysis outputs only and contains no approve/reject/request-more-info decision logic`
    ])}
    <p><strong>Audit note:</strong> ${escapeHtml(guidelineFindings.guidelineStatus)} Extraction quality depends on uploaded file readability in browser-only mode.</p>
  `;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const partnerName = document.getElementById('partnerName').value.trim();
  const claimedAmountRaw = document.getElementById('claimedAmount').value;
  const claimedAmount = Number(claimedAmountRaw);
  const files = Array.from(document.getElementById('documents').files);

  if (!partnerName || Number.isNaN(claimedAmount) || claimedAmount < 0 || files.length === 0) {
    auditPill.textContent = 'Missing or invalid required fields';
    return;
  }

  auditPill.textContent = 'Running analysis...';

  const [extracted, guidelinePayload] = await Promise.all([
    extractFromUploadedDocuments(files, partnerName),
    loadGuidelineDocs()
  ]);

  const guidelineFindings = buildGuidelineFindings(extracted, guidelinePayload, files.length);

  renderResults({
    partnerName,
    claimedAmount,
    files,
    extracted,
    guidelineFindings
  });

  resultsPanel.hidden = false;
  generatedAt.textContent = `Generated on ${new Date().toLocaleString()}`;
  auditPill.textContent = 'Analysis complete (heuristic extraction + guideline mapping)';
});
