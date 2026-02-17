"""
Summarize a meeting transcript into a short summary, key insights, decisions, and action items.
Uses DeepSeek API (OpenAI-compatible) when DEEPSEEK_API_KEY is set; otherwise returns None.
"""
import json
import os
import re
import sys

DEEPSEEK_API_KEY = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
DEEPSEEK_BASE_URL = (os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").strip()
DEEPSEEK_MODEL = (os.getenv("DEEPSEEK_MODEL") or "deepseek-chat").strip()


def _log(msg: str) -> None:
    print(f"[summarize] {msg}", flush=True)


def summarize_transcript(transcript: str) -> dict | None:
    """
    Return a dict with keys: summary, key_insights (list), decisions (list), action_items (list of {text, assignee?}).
    Returns None if DEEPSEEK_API_KEY is not set or on error.
    """
    if not DEEPSEEK_API_KEY:
        _log("DEEPSEEK_API_KEY not set; skipping summarization")
        return None
    transcript = (transcript or "").strip()
    if not transcript or len(transcript) < 50:
        _log("Transcript too short to summarize")
        return None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    except Exception as e:
        _log(f"DeepSeek client init failed: {e}")
        return None

    prompt = """You are a meeting assistant. Summarize the following meeting transcript.

Return a JSON object with exactly these keys (use empty arrays if none):
- "summary": A short 2–4 sentence overview of what the meeting was about and main outcomes.
- "key_insights": Array of strings: 3–7 important insights or takeaways (one short sentence each).
- "decisions": Array of strings: decisions that were made (e.g. "Use API v2 by Friday").
- "action_items": Array of objects, each with "text" (string) and optional "assignee" (string): tasks to do after the meeting.

Transcript:
"""
    # Truncate very long transcripts to stay within context
    max_chars = 12000
    if len(transcript) > max_chars:
        transcript = transcript[:max_chars] + "\n[... transcript truncated ...]"
        _log(f"Transcript truncated to {max_chars} chars for summarization")

    try:
        _log("Calling DeepSeek for summarization...")
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": "You respond only with valid JSON. No markdown, no code fences."},
                {"role": "user", "content": prompt + transcript},
            ],
            temperature=0.3,
            max_tokens=1500,
        )
        content = (response.choices[0].message.content or "").strip()
        if not content:
            _log("DeepSeek returned empty content")
            return None
        # Strip markdown code block if present
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        data = json.loads(content)
        summary = (data.get("summary") or "").strip()
        key_insights = data.get("key_insights")
        decisions = data.get("decisions")
        action_items = data.get("action_items")
        if not isinstance(key_insights, list):
            key_insights = []
        if not isinstance(decisions, list):
            decisions = []
        if not isinstance(action_items, list):
            action_items = []
        # Normalize action items to {text, assignee?}
        normalized_actions = []
        for item in action_items:
            if isinstance(item, dict) and item.get("text"):
                normalized_actions.append({
                    "text": str(item["text"]).strip(),
                    "assignee": str(item["assignee"]).strip() if item.get("assignee") else None,
                })
            elif isinstance(item, str) and item.strip():
                normalized_actions.append({"text": item.strip(), "assignee": None})
        if not summary and not key_insights and not decisions and not normalized_actions:
            _log("DeepSeek response had no usable summary fields")
            return None
        _log(f"Summarization done: summary={len(summary)} chars, insights={len(key_insights)}, decisions={len(decisions)}, actions={len(normalized_actions)}")
        return {
            "summary": summary or "No summary generated.",
            "key_insights": [str(x).strip() for x in key_insights if str(x).strip()],
            "decisions": [str(x).strip() for x in decisions if str(x).strip()],
            "action_items": normalized_actions,
        }
    except json.JSONDecodeError as e:
        _log(f"JSON parse error: {e}")
        return None
    except Exception as e:
        _log(f"Summarization failed: {type(e).__name__}: {e}")
        if hasattr(sys, "stderr"):
            import traceback
            traceback.print_exc(file=sys.stderr)
        return None
