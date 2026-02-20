"""
Foxit Document Generation + PDF Services for meeting report PDFs.
Uses both APIs: Doc Gen creates PDF from template, PDF Services compresses and linearizes.
"""
import base64
import json
import os
import time
from datetime import datetime

import requests

FOXIT_HOST = (os.getenv("FOXIT_HOST") or "https://na1.fusion.foxit.com").rstrip("/")
FOXIT_CLIENT_ID = (os.getenv("FOXIT_CLIENT_ID") or "").strip()
FOXIT_CLIENT_SECRET = (os.getenv("FOXIT_CLIENT_SECRET") or "").strip()
FOXIT_PDF_SERVICES_CLIENT_ID = (os.getenv("FOXIT_PDF_SERVICES_CLIENT_ID") or "").strip()
FOXIT_PDF_SERVICES_CLIENT_SECRET = (os.getenv("FOXIT_PDF_SERVICES_CLIENT_SECRET") or "").strip()


def _load_env():
    """Ensure .env is loaded (for local runs)."""
    if not FOXIT_CLIENT_ID or not FOXIT_CLIENT_SECRET:
        try:
            from dotenv import load_dotenv
            d = os.path.dirname(os.path.abspath(__file__))
            load_dotenv(os.path.join(d, ".env"), override=True)
            load_dotenv(os.path.join(os.path.dirname(d), ".env"), override=True)
        except Exception:
            pass


def _get_creds():
    """Return (client_id, client_secret) for Document Generation API."""
    _load_env()
    cid = (os.getenv("FOXIT_CLIENT_ID") or FOXIT_CLIENT_ID or "").strip()
    csec = (os.getenv("FOXIT_CLIENT_SECRET") or FOXIT_CLIENT_SECRET or "").strip()
    return (cid, csec) if (cid and csec) else (None, None)


def _get_pdf_services_creds():
    """Return (client_id, client_secret) for PDF Services API. Falls back to main creds if not set."""
    _load_env()
    cid = (os.getenv("FOXIT_PDF_SERVICES_CLIENT_ID") or FOXIT_PDF_SERVICES_CLIENT_ID or "").strip()
    csec = (os.getenv("FOXIT_PDF_SERVICES_CLIENT_SECRET") or FOXIT_PDF_SERVICES_CLIENT_SECRET or "").strip()
    if cid and csec:
        return (cid, csec)
    return _get_creds()


def _log(msg: str) -> None:
    print(f"[foxit] {msg}", flush=True)


def _sanitize(s: str, max_len: int = 50000) -> str:
    """Remove control chars and truncate to avoid API issues."""
    if not s:
        return ""
    s = "".join(c for c in str(s) if ord(c) >= 32 or c in "\n\r\t")
    return s[:max_len] if len(s) > max_len else s


def _format_duration(meeting_doc: dict) -> str:
    """Get duration as M:SS from meeting doc (duration_seconds or duration string)."""
    dur_sec = meeting_doc.get("duration_seconds")
    if dur_sec is not None:
        try:
            s = float(dur_sec)
            if s >= 0:
                return f"{int(s // 60)}:{int(s % 60):02d}"
        except (TypeError, ValueError):
            pass
    return _sanitize((meeting_doc.get("duration") or "0:00").strip(), 50)


def _build_document_values(meeting_doc: dict) -> dict:
    """Transform meeting MongoDB doc to Foxit documentValues format."""
    title = _sanitize((meeting_doc.get("title") or "").strip() or "Meeting", 200)
    summary = _sanitize((meeting_doc.get("summary") or "").strip() or "No summary available.", 10000)
    duration = _format_duration(meeting_doc)
    word_count = meeting_doc.get("word_count") or 0
    transcript = (meeting_doc.get("transcript") or "").strip()
    full_transcript = _sanitize(transcript or "No transcript.", 50000)

    key_insights_raw = meeting_doc.get("key_insights") or []
    key_insights = [{"insight": _sanitize(str(x).strip(), 2000)} for x in key_insights_raw if str(x).strip()]
    key_insights_text = "\n• ".join([x["insight"] for x in key_insights]) if key_insights else "None extracted."
    if key_insights_text != "None extracted.":
        key_insights_text = "• " + key_insights_text

    decisions_raw = meeting_doc.get("decisions") or []
    decisions = [{"decision": _sanitize(str(x).strip(), 2000)} for x in decisions_raw if str(x).strip()]
    decisions_text = "\n• ".join([x["decision"] for x in decisions]) if decisions else "None extracted."
    if decisions_text != "None extracted.":
        decisions_text = "• " + decisions_text

    action_items_raw = meeting_doc.get("action_items") or []
    action_items = []
    for item in action_items_raw:
        if isinstance(item, dict):
            task = (item.get("task") or item.get("text") or "").strip()
        else:
            task = str(item).strip()
        if task:
            assignee = (item.get("assignee") if isinstance(item, dict) else None) or ""
            action_items.append({"task": _sanitize(task, 1000), "assignee": _sanitize(str(assignee).strip() or "-", 200)})
    action_items_text = "\n• ".join(f"{x['task']} (→ {x['assignee']})" for x in action_items) if action_items else "None extracted."
    if action_items_text != "None extracted.":
        action_items_text = "• " + action_items_text

    return {
        "title": title,
        "summary": summary,
        # Omit "today" - Foxit has a built-in {{today}} token; we must not override it
        "duration": duration,
        "wordCount": str(word_count),
        "fullTranscript": full_transcript,
        "keyInsightsText": _sanitize(key_insights_text, 5000),
        "decisionsText": _sanitize(decisions_text, 5000),
        "actionItemsText": _sanitize(action_items_text, 8000),
    }


def _doc_gen_pdf(document_values: dict, template_b64: str, client_id: str, client_secret: str) -> bytes | None:
    """Call Foxit Document Generation API. Returns PDF bytes or None."""
    url = f"{FOXIT_HOST}/document-generation/api/GenerateDocumentBase64"
    headers = {"client_id": client_id, "client_secret": client_secret}
    try:
        r = requests.post(
            url,
            json={
                "outputFormat": "pdf",
                "documentValues": document_values,
                "base64FileString": template_b64,
            },
            headers=headers,
            timeout=60,
        )
        if r.status_code != 200:
            _log(f"Doc Gen HTTP {r.status_code}: {r.text[:300]}")
            return None
        data = r.json()
    except Exception as e:
        _log(f"Doc Gen error: {e}")
        return None

    b64 = data.get("base64FileString")
    if not b64:
        err = data.get("errorCode") or data.get("message") or str(data)
        _log(f"Doc Gen error: {err}. Full response keys: {list(data.keys())}")
        return None
    try:
        return base64.b64decode(b64)
    except Exception as e:
        _log(f"Doc Gen base64 decode error: {e}")
        return None


def _pdf_services_compress_linearize(pdf_bytes: bytes, client_id: str, client_secret: str) -> bytes | None:
    """Upload PDF, compress, linearize, download. Returns final PDF bytes or None."""
    headers = {"client_id": client_id, "client_secret": client_secret}

    # 1. Upload
    url_upload = f"{FOXIT_HOST}/pdf-services/api/documents/upload"
    try:
        files = {"file": ("report.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(url_upload, files=files, headers=headers, timeout=30)
        r.raise_for_status()
        upload_data = r.json()
    except Exception as e:
        _log(f"PDF Services upload error: {e}")
        return None

    doc_id = upload_data.get("documentId")
    if not doc_id:
        _log(f"Upload returned no documentId: {upload_data}")
        return None

    def _start_compress() -> str | None:
        url = f"{FOXIT_HOST}/pdf-services/api/documents/modify/pdf-compress"
        r = requests.post(url, json={"documentId": doc_id, "compressionLevel": "MEDIUM"}, headers=headers, timeout=30)
        r.raise_for_status()
        return r.json().get("taskId")

    def _poll_task(task_id: str) -> dict | None:
        url = f"{FOXIT_HOST}/pdf-services/api/tasks/{task_id}"
        for _ in range(24):
            r = requests.get(url, headers=headers, timeout=15)
            r.raise_for_status()
            j = r.json()
            status = j.get("status", "")
            if status == "COMPLETED":
                return j
            if status == "FAILED":
                _log(f"Task failed: {j}")
                return None
            time.sleep(2)
        _log("Task poll timeout")
        return None

    def _start_linearize(doc_id: str) -> str | None:
        url = f"{FOXIT_HOST}/pdf-services/api/documents/optimize/pdf-linearize"
        r = requests.post(url, json={"documentId": doc_id}, headers=headers, timeout=30)
        r.raise_for_status()
        return r.json().get("taskId")

    def _download(doc_id: str) -> bytes | None:
        url = f"{FOXIT_HOST}/pdf-services/api/documents/{doc_id}/download"
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        return r.content

    # 2. Compress
    task_id = _start_compress()
    if not task_id:
        _log("Compress job failed to start")
        return _download(doc_id)
    result = _poll_task(task_id)
    if not result:
        return _download(doc_id)
    result_doc_id = result.get("resultDocumentId")
    if not result_doc_id:
        return _download(doc_id)

    # 3. Linearize
    task_id2 = _start_linearize(result_doc_id)
    if not task_id2:
        return _download(result_doc_id)
    result2 = _poll_task(task_id2)
    if not result2:
        return _download(result_doc_id)
    final_doc_id = result2.get("resultDocumentId")
    if not final_doc_id:
        return _download(result_doc_id)

    # 4. Download
    return _download(final_doc_id)


def generate_meeting_report_pdf(meeting_doc: dict) -> bytes | None:
    """
    Generate a PDF report for the meeting using Foxit Document Generation + PDF Services.
    Returns PDF bytes or None on failure.
    """
    client_id, client_secret = _get_creds()
    if not client_id or not client_secret:
        _log("FOXIT_CLIENT_ID and FOXIT_CLIENT_SECRET not set")
        return None

    template_path = os.path.join(os.path.dirname(__file__), "templates", "meeting_report.docx")
    if not os.path.exists(template_path):
        _log(f"Template not found: {template_path}")
        return None

    with open(template_path, "rb") as f:
        template_b64 = base64.b64encode(f.read()).decode("ascii")

    document_values = _build_document_values(meeting_doc)

    _log("Calling Foxit Document Generation...")
    pdf_bytes = _doc_gen_pdf(document_values, template_b64, client_id, client_secret)
    if not pdf_bytes:
        return None

    _log("Calling Foxit PDF Services (compress + linearize)...")
    pdf_svc_id, pdf_svc_secret = _get_pdf_services_creds()
    final_bytes = _pdf_services_compress_linearize(pdf_bytes, pdf_svc_id, pdf_svc_secret) if (pdf_svc_id and pdf_svc_secret) else None
    if final_bytes:
        _log(f"Report generated: {len(final_bytes)} bytes")
        return final_bytes
    _log("PDF Services failed; returning Doc Gen output")
    return pdf_bytes
