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

function severityTag(level) {
  return `<span class="severity ${level}">${level}</span>`;
}

function toCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 'N/A';
  return number.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function buildMockExtractedData(partnerName, claimedAmount, files) {
  const names = files.length > 0 ? [partnerName, `${partnerName} Services LLC`] : [partnerName];
  const fileTotal = claimedAmount * (files.length > 0 ? 0.98 : 1);

  return {
    partnerNames: names,
    invoiceNumber: files[0] ? `INV-${String(files[0].name.length * 77).padStart(6, '0')}` : 'INV-001245',
    invoiceDate: '2026-03-28',
    vendorName: files[0] ? files[0].name.split('.')[0] : 'Unknown Vendor',
    requestApprovalNumber: files[1] ? `REQ-${files[1].size}` : 'Not found',
    netAmount: fileTotal.toFixed(2),
    vat: (fileTotal * 0.2).toFixed(2),
    totalAmount: (fileTotal * 1.2).toFixed(2),
    currency: 'USD',
    activityDescription: 'Marketing activation and event execution',
    proofOfPerformance: files.length > 1 ? 'Delivery photos and signed completion note found' : 'Limited evidence detected in uploaded documents'
  };
}

function renderList(items) {
  if (!items.length) return '<p class="empty">No data available.</p>';
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function renderResults({ partnerName, claimedAmount, files }) {
  const extracted = buildMockExtractedData(partnerName, claimedAmount, files);
  const uploadedNames = files.map((file) => `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`);
  const claimedAmountFormatted = toCurrency(claimedAmount);
  const extractedTotalFormatted = toCurrency(extracted.totalAmount);

  const amountDiff = Math.abs(Number(claimedAmount) - Number(extracted.totalAmount));
  const amountMatchState = amountDiff === 0 ? 'exact match' : amountDiff < 150 ? 'partial match' : 'mismatch';

  document.getElementById(sectionIds.claimInputs).innerHTML = `
    <h3>Claim Inputs</h3>
    ${renderList([
      `Partner Name (entered): <strong>${partnerName}</strong>`,
      `Claimed Amount (entered): <strong>${claimedAmountFormatted}</strong>`
    ])}
  `;

  document.getElementById(sectionIds.docSummary).innerHTML = `
    <h3>Uploaded Documents Summary</h3>
    ${renderList(uploadedNames)}
    <p><strong>Total files:</strong> ${files.length}</p>
  `;

  document.getElementById(sectionIds.extractedData).innerHTML = `
    <h3>Extracted Data</h3>
    ${renderList([
      `Partner Names: ${extracted.partnerNames.join(', ')}`,
      `Invoice Number: ${extracted.invoiceNumber}`,
      `Invoice Date: ${extracted.invoiceDate}`,
      `Vendor Name: ${extracted.vendorName}`,
      `Request/Approval Number: ${extracted.requestApprovalNumber}`,
      `Net Amount: ${toCurrency(extracted.netAmount)}`,
      `VAT: ${toCurrency(extracted.vat)}`,
      `Total Amount: ${extractedTotalFormatted}`,
      `Currency: ${extracted.currency}`,
      `Activity Description: ${extracted.activityDescription}`,
      `Proof-of-Performance Indicators: ${extracted.proofOfPerformance}`
    ])}
  `;

  document.getElementById(sectionIds.matchingAnalysis).innerHTML = `
    <h3>Matching Analysis</h3>
    ${renderList([
      `${severityTag('low')} Extracted partner names vs entered partner name: partial match`,
      `${severityTag(amountMatchState === 'mismatch' ? 'high' : amountMatchState === 'partial match' ? 'medium' : 'low')} Extracted total amount (${extractedTotalFormatted}) vs entered claimed amount (${claimedAmountFormatted}): ${amountMatchState}`,
      `${severityTag('medium')} Multiple totals found: Net, VAT, and gross totals are present`,
      `${severityTag('low')} Unclear totals: No ambiguous total label detected in sample extraction`,
      `${severityTag('medium')} Currency inconsistencies: no cross-currency entries detected, but only sample extraction available`,
      `${severityTag('medium')} Missing financial fields: request/approval number ${extracted.requestApprovalNumber === 'Not found' ? 'not found' : 'found'}`
    ])}
  `;

  document.getElementById(sectionIds.guidelineAnalysis).innerHTML = `
    <h3>Guideline Analysis</h3>
    ${renderList([
      `${severityTag('medium')} Document completeness observation: ${files.length < 2 ? 'supporting evidence set appears limited' : 'core claim documents appear present'}`,
      `${severityTag('low')} Invoice structure observation: invoice-like fields are present in sample parse`,
      `${severityTag('medium')} Proof-of-performance observation: ${extracted.proofOfPerformance}`,
      `${severityTag('medium')} Missing support indicators: signed acceptance or traceable delivery artifacts may require review`,
      `${severityTag('low')} Claim documentation notes: mock guideline mapping only; full parser integration pending`
    ])}
  `;

  document.getElementById(sectionIds.aiScreening).innerHTML = `
    <h3>AI Screening (Advisory Only)</h3>
    ${renderList([
      `${severityTag('medium')} possible anomaly detected: spacing irregularities around numeric fields`,
      `${severityTag('low')} possible manipulation indicator: font family variance in one section`,
      `${severityTag('medium')} metadata inconsistency: created/modified timestamps require manual cross-check`,
      `${severityTag('low')} formatting inconsistency: line alignment differs between header and body`,
      `${severityTag('medium')} suspicious image region: stamp area compression appears uneven`,
      `${severityTag('medium')} VAT/math inconsistencies: recomputation tolerance exceeded by sample delta`,
      `${severityTag('high')} duplicate invoice number detection: sample check suggests potential overlap with prior claim register (mock dataset)`
    ])}
    <p class="disclaimer">
      Disclaimer: AI Screening is an advisory indicator engine only. It does not prove fraud, forgery, or authenticity,
      and all findings require manual review.
    </p>
  `;

  document.getElementById(sectionIds.overallSummary).innerHTML = `
    <h3>Overall Summary</h3>
    ${renderList([
      `${severityTag('medium')} Neutral assessment generated from current uploaded files and mock extraction pipeline`,
      `${severityTag('medium')} Manual review recommended for amount reconciliation and metadata checks`,
      `${severityTag('low')} This MVP provides analysis outputs only and contains no approve/reject/request-more-info decision logic`
    ])}
    <p><strong>Audit note:</strong> Initial MVP uses sample analysis output where full document parsing is not yet implemented.</p>
  `;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const partnerName = document.getElementById('partnerName').value.trim();
  const claimedAmount = document.getElementById('claimedAmount').value;
  const files = Array.from(document.getElementById('documents').files);

  if (!partnerName || !claimedAmount || files.length === 0) {
    auditPill.textContent = 'Missing required fields';
    return;
  }

  renderResults({ partnerName, claimedAmount, files });
  resultsPanel.hidden = false;

  generatedAt.textContent = `Generated on ${new Date().toLocaleString()}`;
  auditPill.textContent = 'Analysis complete (MVP mock + extraction placeholders)';
});
