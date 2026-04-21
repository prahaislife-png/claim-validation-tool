#!/usr/bin/env python3
"""
PDF extraction pipeline with per-page text extraction and OCR fallback.

Pipeline (per page):
  1. Try normal text extraction with PyMuPDF (fitz).
  2. If extracted text is below the minimum threshold, render that page to an
     image and run OCR on it.
  3. Merge direct-text and OCR output into a single normalized document.

Renderers (tried in order):
  - Poppler via pdf2image  (if the poppler binary is installed)
  - PyMuPDF (fitz)         (no Poppler needed — works everywhere PyMuPDF works)

Status codes returned per file:
  - text_extracted      : every page yielded enough text without OCR
  - partial_ocr_used    : at least one page needed OCR, but not all
  - full_ocr_used       : every page required OCR (scanned / image-only PDF)

CLI usage:
    python scripts/extract_pdfs.py <pdf-or-directory> [more...]
    # writes <name>.extracted.txt next to each PDF

Dependencies:
    pip install pymupdf pytesseract Pillow
    # optional, preferred renderer:
    pip install pdf2image   # + system poppler-utils

This module strictly returns text that was extracted or OCR-read from the
PDF bytes — it never invents, paraphrases, or summarizes content.
"""

from __future__ import annotations

import io
import logging
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

# Pages with fewer non-whitespace characters than this are considered
# "insufficient" and trigger OCR fallback. 40 chars ≈ one short sentence.
MIN_CHARS_PER_PAGE = 40

log = logging.getLogger("pdf_extract")


# ───────────────────────── data classes ─────────────────────────

@dataclass
class PageResult:
    page_number: int          # 1-indexed
    extracted_text_length: int
    ocr_used: bool
    final_text_length: int
    text: str
    renderer: Optional[str] = None  # "poppler" | "pymupdf" | None


@dataclass
class ExtractionResult:
    pdf_path: str
    pages: List[PageResult] = field(default_factory=list)
    status: str = "text_extracted"   # text_extracted | partial_ocr_used | full_ocr_used
    merged_text: str = ""


# ───────────────────────── capability probes ─────────────────────────

def _has_pymupdf() -> bool:
    try:
        import fitz  # noqa: F401
        return True
    except ImportError:
        return False


def _has_pdf2image_and_poppler() -> bool:
    """True only if pdf2image imports AND a poppler binary is on PATH."""
    try:
        from pdf2image import convert_from_path  # noqa: F401
    except ImportError:
        return False
    return shutil.which("pdftoppm") is not None


def _has_ocr() -> bool:
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        return False
    # pytesseract needs the tesseract binary too
    return shutil.which("tesseract") is not None


# ───────────────────────── text extraction ─────────────────────────

def _extract_text_per_page_fitz(pdf_path: str) -> List[str]:
    """Return per-page extracted text using PyMuPDF."""
    import fitz
    doc = fitz.open(pdf_path)
    try:
        return [(doc[i].get_text("text") or "") for i in range(len(doc))]
    finally:
        doc.close()


def _render_page_pymupdf(pdf_path: str, page_index: int, dpi: int = 200):
    """Render a single page to a PIL.Image using PyMuPDF (no Poppler)."""
    import fitz
    from PIL import Image
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_index]
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    finally:
        doc.close()


def _render_page_poppler(pdf_path: str, page_index: int, dpi: int = 200):
    """Render a single page using pdf2image (requires Poppler binaries)."""
    from pdf2image import convert_from_path
    images = convert_from_path(
        pdf_path, dpi=dpi,
        first_page=page_index + 1, last_page=page_index + 1,
    )
    return images[0] if images else None


def _ocr_image(image) -> str:
    import pytesseract
    try:
        return pytesseract.image_to_string(image) or ""
    except Exception as e:
        log.warning("OCR failed: %s", e)
        return ""


# ───────────────────────── public API ─────────────────────────

def extract_pdf(pdf_path: str, min_chars: int = MIN_CHARS_PER_PAGE) -> ExtractionResult:
    """
    Extract text from `pdf_path` page by page, using OCR only when a page's
    direct text is below `min_chars`. Never fabricates content.

    Raises RuntimeError if neither PyMuPDF nor a working alternative is
    available (we do not silently return empty output in that case).
    """
    if not _has_pymupdf():
        raise RuntimeError(
            "PyMuPDF (pymupdf) is required for per-page text extraction. "
            "Install with: pip install pymupdf"
        )

    ocr_available = _has_ocr()
    poppler_available = _has_pdf2image_and_poppler()
    renderer_name = "poppler" if poppler_available else "pymupdf"

    if not ocr_available:
        log.warning(
            "OCR unavailable (missing pytesseract or tesseract binary). "
            "Pages without embedded text will be recorded as empty."
        )

    result = ExtractionResult(pdf_path=pdf_path)
    page_texts = _extract_text_per_page_fitz(pdf_path)
    ocr_pages = 0

    for i, raw_text in enumerate(page_texts):
        raw_text = raw_text or ""
        extracted_len = len(raw_text.strip())
        ocr_used = False
        renderer_used: Optional[str] = None
        final_text = raw_text

        if extracted_len < min_chars and ocr_available:
            try:
                image = (
                    _render_page_poppler(pdf_path, i)
                    if poppler_available
                    else _render_page_pymupdf(pdf_path, i)
                )
                if image is not None:
                    ocr_text = _ocr_image(image)
                    # Only take OCR output if it's actually richer than direct text
                    if len(ocr_text.strip()) > extracted_len:
                        final_text = ocr_text
                        ocr_used = True
                        renderer_used = renderer_name
                        ocr_pages += 1
            except Exception as e:
                log.warning(
                    "page=%d renderer=%s render/OCR failed: %s",
                    i + 1, renderer_name, e,
                )

        final_len = len(final_text.strip())
        log.info(
            "page=%d extracted_text_length=%d ocr_used=%s "
            "renderer=%s final_text_length=%d",
            i + 1, extracted_len, ocr_used, renderer_used or "-", final_len,
        )

        result.pages.append(PageResult(
            page_number=i + 1,
            extracted_text_length=extracted_len,
            ocr_used=ocr_used,
            final_text_length=final_len,
            text=final_text,
            renderer=renderer_used,
        ))

    # ─── overall status ───
    total = len(result.pages)
    if total == 0:
        result.status = "text_extracted"  # empty PDF; nothing to OCR
    elif ocr_pages == 0:
        result.status = "text_extracted"
    elif ocr_pages == total:
        result.status = "full_ocr_used"
    else:
        result.status = "partial_ocr_used"

    # ─── merged, normalized output ───
    parts: List[str] = []
    for p in result.pages:
        # normalize: drop empty lines, trim trailing whitespace per line
        cleaned = "\n".join(
            line.rstrip() for line in p.text.splitlines() if line.strip()
        )
        if cleaned:
            parts.append(f"--- page {p.page_number} ---\n{cleaned}")
    result.merged_text = "\n\n".join(parts)

    return result


# ───────────────────────── CLI ─────────────────────────

def _collect_targets(args: List[str]) -> List[Path]:
    targets: List[Path] = []
    for arg in args:
        p = Path(arg)
        if p.is_dir():
            targets.extend(sorted(p.glob("*.pdf")))
        elif p.suffix.lower() == ".pdf" and p.is_file():
            targets.append(p)
        else:
            log.warning("skipping %s (not a PDF or directory)", arg)
    return targets


def main(argv: List[str]) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[pdf_extract] %(levelname)s %(message)s",
    )
    if len(argv) < 2:
        print(
            "Usage: extract_pdfs.py <pdf-or-directory> [more...]",
            file=sys.stderr,
        )
        return 2

    targets = _collect_targets(argv[1:])
    if not targets:
        log.warning("no PDF files found")
        return 0

    exit_code = 0
    for pdf in targets:
        log.info("processing %s", pdf)
        try:
            result = extract_pdf(str(pdf))
        except Exception as e:
            log.error("failed to process %s: %s", pdf, e)
            exit_code = 1
            continue

        out_path = pdf.with_suffix(".extracted.txt")
        out_path.write_text(result.merged_text, encoding="utf-8")
        log.info(
            "done %s status=%s pages=%d bytes=%d -> %s",
            pdf.name, result.status, len(result.pages),
            len(result.merged_text), out_path.name,
        )

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
