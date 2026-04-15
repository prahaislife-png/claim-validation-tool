# Claim Validation Tool

MVP internal web app to analyze claim documents with neutral findings and advisory AI screening.

## Scope (Phase 1)
- Inputs only: Partner Name, Claimed Amount, Uploaded Documents.
- Analysis outputs only (no approval, rejection, or request-more-information logic).
- AI Screening is advisory only and does not prove fraud or forgery.
- Uses mock/sample analysis output while full parsing is pending.

## Run locally
Because this is a static web MVP, run any simple local file server from this repository root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
