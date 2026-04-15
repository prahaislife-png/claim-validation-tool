# Claim Validation Tool

Internal web MVP to analyze uploaded claim documents and generate neutral findings for manual review.

## What this version now does
- Inputs stay limited to: **Partner Name**, **Claimed Amount**, **Uploaded Documents**.
- Produces all required result sections:
  - Claim Inputs
  - Uploaded Documents Summary
  - Extracted Data
  - Matching Analysis
  - Guideline Analysis
  - AI Screening
  - Overall Summary
- Runs browser-side heuristic extraction from uploaded files (metadata + readable text snippets where available).
- Loads guideline/source reference documents from `reference_docs/index.json` and maps findings against them.
- Keeps **AI Screening strictly advisory** and includes an explicit disclaimer that it does not prove fraud or forgery.
- No approve/reject/request-more-info decision logic.

## Reference guideline docs (for current and future additions)
1. Put your source guideline files in `reference_docs/`.
2. Add them to `reference_docs/index.json` under `documents`.
3. Use text-readable files (`.txt`, `.md`, `.json`, `.csv`) for best browser parsing accuracy.
   - Binary docs (PDF/DOCX/XLSX/images) still work in upload flow, but browser extraction from those formats is metadata-first in this MVP.

## Run locally
```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000`.
