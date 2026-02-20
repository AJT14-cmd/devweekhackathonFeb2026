"""
You.com API integration for meeting summarization.
Uses Express Agent (POST https://api.you.com/v1/agents/runs) when YOUCOM_API_KEY is set.
Get an API key at https://you.com/platform
"""
import json
import os
import re
import urllib.request
import urllib.error

YOUCOM_API_KEY = (os.getenv("YOUCOM_API_KEY") or "").strip()
AGENTS_BASE_URL = (os.getenv("YOUCOM_AGENTS_URL") or "https://api.you.com").rstrip("/")


def _log(msg: str) -> None:
    print(f"[youcom] {msg}", flush=True)


def _get_api_key() -> str:
    """Return YOUCOM_API_KEY (from env or reloaded from .env)."""
    key = (os.getenv("YOUCOM_API_KEY") or "").strip()
    if key:
        return key
    # Optional: load from backend/.env if not in env
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        if os.path.isfile(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("YOUCOM_API_KEY=") and not line.startswith("#"):
                        val = line.split("=", 1)[1].strip().strip('"\'')
                        if val:
                            return val
    except Exception:
        pass
    return ""


def summarize_with_agent(transcript: str) -> dict | None:
    """
    Use You.com Express Agent to summarize a transcript.
    Returns dict with summary, key_insights, decisions, action_items, research_insights, summary_source.
    Returns None if YOUCOM_API_KEY not set or on error.
    """
    transcript = (transcript or "").strip()
    if not transcript or len(transcript) < 50:
        _log("Transcript too short to summarize")
        return None

    key = _get_api_key()
    if not key:
        _log("YOUCOM_API_KEY not set; skipping agent summarization")
        return None

    prompt = """You are a meeting assistant. Summarize the following meeting transcript.

Return a JSON object with exactly these keys (use empty arrays if none):
- "summary": A short 2–4 sentence overview of what the meeting was about and main outcomes.
- "key_insights": Array of strings: 3–7 important insights or takeaways (one short sentence each).
- "decisions": Array of strings: decisions that were made.
- "action_items": Array of objects with "text" (string) and optional "assignee" (string): tasks to do after the meeting.

Respond with only valid JSON. No markdown, no code fences, no other text.

Transcript:
"""
    # Truncate very long transcripts
    max_chars = 12000
    if len(transcript) > max_chars:
        transcript = transcript[:max_chars] + "\n[... transcript truncated ...]"
        _log(f"Transcript truncated to {max_chars} chars")

    url = f"{AGENTS_BASE_URL}/v1/agents/runs"
    body = json.dumps({
        "agent": "express",
        "input": prompt + transcript,
        "stream": False,
    }).encode("utf-8")

    # Cloudflare in front of api.you.com returns 1010 (Access Denied) for requests that
    # don't look like a browser. Send browser-like headers to reduce bot detection.
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )

    try:
        _log("Calling You.com Express Agent...")
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_str = e.read().decode() if e.fp else ""
        _log(f"You.com API error {e.code}: {body_str[:300]}")
        if e.code == 1010:
            _log("Error 1010 = Cloudflare Access Denied. Server-side requests may be blocked. Try again; we send browser-like headers to reduce this.")
        return None
    except urllib.error.URLError as e:
        _log(f"You.com request failed: {e.reason}")
        return None
    except Exception as e:
        _log(f"You.com request failed: {type(e).__name__}: {e}")
        return None

    # Collect text from output items (type message.answer)
    content = ""
    for item in data.get("output") or []:
        if isinstance(item, dict) and item.get("type") == "message.answer" and item.get("text"):
            content += item.get("text", "")

    content = content.strip()
    if not content:
        _log("You.com returned empty content")
        return None

    # Strip markdown code block if present
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)

    try:
        out = json.loads(content)
    except json.JSONDecodeError as e:
        _log(f"JSON parse error: {e}")
        return None

    summary = (out.get("summary") or "").strip()
    key_insights = out.get("key_insights")
    decisions = out.get("decisions")
    action_items = out.get("action_items")

    if not isinstance(key_insights, list):
        key_insights = []
    if not isinstance(decisions, list):
        decisions = []
    if not isinstance(action_items, list):
        action_items = []

    normalized_actions = []
    for item in action_items:
        if isinstance(item, dict) and item.get("text"):
            normalized_actions.append({
                "text": str(item["text"]).strip(),
                "assignee": str(item["assignee"]).strip() if item.get("assignee") else None,
            })
        elif isinstance(item, str) and item.strip():
            normalized_actions.append({"text": item.strip(), "assignee": None})

    _log(f"Summarization done: summary={len(summary)} chars, insights={len(key_insights)}, actions={len(normalized_actions)}")
    return {
        "summary": summary or "No summary generated.",
        "key_insights": [str(x).strip() for x in key_insights if str(x).strip()],
        "decisions": [str(x).strip() for x in decisions if str(x).strip()],
        "action_items": normalized_actions,
        "research_insights": [],  # Optional: add Search API later
        "summary_source": "youcom",
    }


def _summarize_via_search_only(transcript: str) -> dict:
    """Fallback when Agent is unavailable: first 500 chars as summary, no copy of transcript, empty lists."""
    transcript = (transcript or "").strip()
    summary = (transcript[:500] + "...") if len(transcript) > 500 else transcript
    if not summary:
        summary = "No summary available."
    return {
        "summary": summary,
        "key_insights": [],
        "decisions": [],
        "action_items": [],
        "research_insights": [],
        "summary_source": "fallback",
    }
