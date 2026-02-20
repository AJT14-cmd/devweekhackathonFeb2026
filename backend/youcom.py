"""
You.com API integration for meeting insights.
- Agents API: Summarizes transcripts with research grounding (replaces DeepSeek)
- Search API: Citation-backed web results for enrichment
Get an API key at https://you.com/platform - $100 free credits for API projects.
"""
import json
import os
import re
import urllib.parse
import urllib.request

# Ensure .env is loaded from backend dir (override=True so we get values even if env was pre-set)
def _load_youcom_env():
    results = []
    try:
        from dotenv import load_dotenv
        _dir = os.path.dirname(os.path.abspath(__file__))
        backend_env = os.path.join(_dir, ".env")
        root_env = os.path.join(os.path.dirname(_dir), ".env")
        results.append(f"backend_env={backend_env} exists={os.path.exists(backend_env)}")
        results.append(f"root_env={root_env} exists={os.path.exists(root_env)}")
        r1 = load_dotenv(backend_env, override=True)
        r2 = load_dotenv(root_env, override=True)
        results.append(f"loaded_backend={r1} loaded_root={r2}")
        val = os.getenv("YOUCOM_API_KEY") or ""
        results.append(f"after_load: len={len(val)} starts_ydc={val.strip().startswith('ydc-')}")
    except Exception as e:
        results.append(f"error={e}")
    for r in results:
        print(f"[youcom.env] {r}", flush=True)
    try:
        import json as _json
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "debug-c21db1.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(_json.dumps({"sessionId":"c21db1","hypothesisId":"key_load","message":"env_load","data":{"results":results,"cwd":os.getcwd()},"timestamp":__import__("time").time()*1000}) + "\n")
    except Exception:
        pass

_load_youcom_env()
YOUCOM_API_KEY = (os.getenv("YOUCOM_API_KEY") or "").strip()

# Fallback: if dotenv didn't load it, try reading .env file directly
if not YOUCOM_API_KEY:
    for env_path in [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
    ]:
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("YOUCOM_API_KEY=") and not line.startswith("#"):
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if val:
                                YOUCOM_API_KEY = val
                                print(f"[youcom.env] fallback: loaded from {env_path}", flush=True)
                                break
            except Exception as e:
                print(f"[youcom.env] fallback read failed: {e}", flush=True)
        if YOUCOM_API_KEY:
            break
# #region agent log
def _dbg_init():
    try:
        import json
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "debug-c21db1.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps({"sessionId":"c21db1","hypothesisId":"H1","location":"youcom.py:init","message":"module load","data":{"has_api_key":bool(YOUCOM_API_KEY),"env_youcom":bool(os.getenv("YOUCOM_API_KEY"))},"timestamp":__import__("time").time()*1000}) + "\n")
    except Exception:
        pass
_dbg_init()
def _dbg(hid: str, msg: str, **data):
    try:
        import json
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "debug-c21db1.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps({"sessionId":"c21db1","hypothesisId":hid,"location":"youcom.py","message":msg,"data":data,"timestamp":__import__("time").time()*1000}) + "\n")
    except Exception:
        pass
# #endregion
# Search API base (ydc-index.io)
SEARCH_BASE_URL = (os.getenv("YOUCOM_SEARCH_URL") or "https://ydc-index.io").rstrip("/")
# Agents API base (api.you.com)
AGENTS_BASE_URL = (os.getenv("YOUCOM_AGENTS_URL") or "https://api.you.com").rstrip("/")


def _log(msg: str) -> None:
    print(f"[youcom] {msg}", flush=True)


def _get_api_key() -> str:
    """Get API key, re-reading env at runtime if module-level load was empty."""
    key = YOUCOM_API_KEY
    if not key:
        _load_youcom_env()
        key = (os.getenv("YOUCOM_API_KEY") or "").strip()
    return key or ""


def summarize_with_agent(transcript: str) -> dict | None:
    """
    Use You.com Express Agent to summarize a transcript. Returns dict with
    summary, key_insights, decisions, action_items, research_insights.
    Returns None if YOUCOM_API_KEY not set or on error.
    """
    api_key = _get_api_key()
    # #region agent log
    _dbg("H1", "summarize_with_agent entry", has_api_key=bool(api_key), transcript_len=len((transcript or "").strip()))
    # #endregion
    if not api_key:
        # #region agent log
        _dbg("H1", "early return: no API key")
        # #endregion
        _log("YOUCOM_API_KEY not set; skipping agent summarization (check backend/.env)")
        return None
    transcript = (transcript or "").strip()
    if not transcript or len(transcript) < 50:
        # #region agent log
        _dbg("H4", "early return: transcript too short", len=len(transcript))
        # #endregion
        _log("Transcript too short for summarization")
        return None
    max_chars = 6000
    if len(transcript) > max_chars:
        transcript = transcript[:max_chars] + "\n[... transcript truncated ...]"
        _log(f"Transcript truncated to {max_chars} chars")
    prompt = """You are an executive meeting summarizer. Your job is to SYNTHESIZE and CONDENSE—never copy or quote verbatim from the transcript.

CRITICAL: Write in your own words. Do NOT echo, reproduce, or paste any part of the transcript. Produce original synthesized text.

Output ONLY a valid JSON object (no markdown, no extra text):
{
  "summary": "2-4 sentences: high-level overview of topics discussed, main outcomes, and conclusions. Write like an executive brief.",
  "key_insights": ["insight 1", "insight 2", ...],
  "decisions": ["decision 1", ...],
  "action_items": [{"text": "task description", "assignee": "name or null"}, ...]
}

- summary: synthesize. Use different words and structure than the transcript.
- key_insights: 3-6 takeaways, each one short sentence. Generalize—don't quote.
- decisions: concrete decisions made.
- action_items: follow-up tasks with optional assignee.

Meeting transcript:
""" + transcript
    url = f"{AGENTS_BASE_URL}/v1/agents/runs"
    # Use express agent (faster, less prone to echoing); skip research tool for cleaner summarization
    body = json.dumps({
        "agent": "express",
        "input": prompt,
        "stream": False,
        "tools": [],  # no web search—focus on synthesis only
    }).encode("utf-8")
    try:
        # #region agent log
        _dbg("H5", "about to call You.com HTTP API", url=url)
        # #endregion
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        # #region agent log
        _dbg("H5", "You.com HTTP request failed", error=str(e)[:100])
        # #endregion
        _log(f"Agent summarization failed: {e}")
        return None
    # Express Agent returns output as array: [{"type":"message.answer","text":"..."}, ...]
    output_raw = ""
    out = data.get("output")
    if isinstance(out, list):
        for item in out:
            if isinstance(item, dict):
                if item.get("type") == "message.answer" and item.get("text"):
                    output_raw += str(item["text"])
                elif item.get("text"):
                    output_raw += str(item["text"])
    if not output_raw:
        output_raw = data.get("output_text") or data.get("text") or data.get("response") or ""
    if not output_raw and isinstance(data.get("runs"), list) and data["runs"]:
        run = data["runs"][0]
        ro = run.get("output")
        if isinstance(ro, list):
            for item in ro:
                if isinstance(item, dict) and item.get("text"):
                    output_raw += str(item["text"])
        else:
            output_raw = run.get("output_text") or run.get("text") or ""
    if not output_raw:
        _log("Agent returned no output")
        return None
    output_raw = (output_raw or "").strip()
    # If output looks like the transcript was echoed (starts with transcript or contains big chunk), use fallback
    transcript_start = transcript[:100].strip()
    if transcript_start and (
        output_raw.startswith(transcript_start[:60]) or
        (transcript_start in output_raw and len(output_raw) > len(transcript) * 0.4)
    ):
        _log("Agent echoed transcript; using fallback")
        return _summarize_via_search_only(transcript)
    # Strip markdown code blocks if present
    if output_raw.startswith("```"):
        output_raw = re.sub(r"^```(?:json)?\s*", "", output_raw)
        output_raw = re.sub(r"\s*```$", "", output_raw)
    try:
        parsed = json.loads(output_raw)
    except json.JSONDecodeError:
        _log("Agent output is not valid JSON; using fallback")
        # If output looks like transcript, use extractive fallback instead of echoing
        if transcript[:80] in output_raw and len(output_raw) > len(transcript) * 0.5:
            return _summarize_via_search_only(transcript)
        # Otherwise use parsed text only if it's clearly a summary (shorter, different from transcript)
        summary_candidate = output_raw[:500] if output_raw else "No summary generated."
        if transcript[:60] in summary_candidate:
            return _summarize_via_search_only(transcript)
        return {
            "summary": summary_candidate,
            "key_insights": [],
            "decisions": [],
            "action_items": [],
            "research_insights": [],
            "summary_source": "youcom",
        }
    summary = (parsed.get("summary") or "").strip()
    key_insights = parsed.get("key_insights")
    decisions = parsed.get("decisions")
    action_items = parsed.get("action_items")
    # If parsed summary is transcript (starts with it or is mostly same), use fallback
    ts = transcript[:80].strip()
    if summary and ts and (summary.startswith(ts[:50]) or (ts in summary and len(summary) > 200)):
        _log("Parsed summary echoes transcript; using fallback")
        return _summarize_via_search_only(transcript)
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
    research_insights = enrich_insights_with_research(summary, key_insights, max_queries=2)
    _log(f"Agent done: summary={len(summary)} chars, insights={len(key_insights)}, research={len(research_insights)}")
    return {
        "summary": summary or "No summary generated.",
        "key_insights": [str(x).strip() for x in key_insights if str(x).strip()],
        "decisions": [str(x).strip() for x in decisions if str(x).strip()],
        "action_items": normalized_actions,
        "research_insights": research_insights,
        "summary_source": "youcom",
    }


def _summarize_via_search_only(transcript: str) -> dict:
    """Fallback when agent echoes: produce a NON-COPY summary plus extracted insights.
    Summary must be generic/synthesized—never quote or repeat transcript text."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", transcript) if len(s.strip()) > 15]
    action_words = ("will", "need to", "let's", "should", "must", "going to", "decided", "agreed", "action")
    key_sentences = [s for s in sentences if any(w in s.lower() for w in action_words)]
    chosen = key_sentences[:3] if len(key_sentences) >= 2 else (sentences[:2] if sentences else [])
    # 1. Summary: NEVER use transcript text. Use a short generic synthesis.
    word_count = len(transcript.split())
    summary = f"This discussion contains {word_count} words. Key topics and follow-up items are listed below. See the full transcript for complete details."
    # 2. Key insights: extracted points (shortened, for bullets—these are from transcript but summary is not)
    key_insights = list(dict.fromkeys(s[:120] for s in chosen if len(s) > 20))[:5]
    if not key_insights and sentences:
        key_insights = ["See transcript for discussion points."]
    # 3. Action items: lines with action patterns (format as {text, assignee})
    lines = transcript.replace("\n", " ").split(".")
    raw_actions = [l.strip()[:120] for l in lines if any(w in l.lower() for w in ("need to", "will", "let's", "action"))][:5]
    action_items = [{"text": t, "assignee": None} for t in raw_actions]
    # 4. Research: enrich with You.com Search if we have API key
    research_items = []
    if YOUCOM_API_KEY and sentences:
        q = " ".join(sentences[0].split()[:8])  # first sentence truncated
        results = search(q, count=3, freshness="month")
        if results:
            for r in results[:3]:
                snippet = (r.get("snippet") or r.get("description") or "").strip()
                if snippet:
                    research_items.append({
                        "insight": snippet[:250],
                        "url": r.get("url") or "",
                        "title": (r.get("title") or "Source").strip(),
                    })
    _log(f"Search fallback: extractive summary + {len(research_items)} research items")
    return {
        "summary": summary or "Meeting recorded. No summary generated.",
        "key_insights": key_insights or ["See transcript for details."],
        "decisions": [],
        "action_items": action_items,
        "research_insights": research_items,
        "summary_source": "fallback",
    }


def search(query: str, count: int = 5, freshness: str = "month") -> list[dict] | None:
    """
    Call You.com Search API. Returns list of result dicts with keys:
    - title, url, description, snippet
    Returns None if YOUCOM_API_KEY not set or on error.
    """
    if not YOUCOM_API_KEY:
        _log("YOUCOM_API_KEY not set; skipping search")
        return None
    query = (query or "").strip()
    if not query:
        return None
    url = f"{SEARCH_BASE_URL}/v1/search?query={urllib.parse.quote(query)}&count={min(count, 10)}&freshness={freshness}"
    try:
        req = urllib.request.Request(url, headers={"X-API-Key": YOUCOM_API_KEY})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        _log(f"Search failed for '{query[:50]}...': {e}")
        return None
    results = data.get("results") or {}
    web = results.get("web") or []
    news = results.get("news") or []
    out = []
    for item in (web + news)[:count]:
        title = (item.get("title") or "").strip()
        url_val = (item.get("url") or "").strip()
        desc = (item.get("description") or "").strip()
        snippets = item.get("snippets") or []
        snippet = snippets[0] if snippets else desc or ""
        if title or snippet:
            out.append({
                "title": title or "Source",
                "url": url_val,
                "description": desc,
                "snippet": (snippet or desc)[:300],
            })
    if not out:
        _log(f"No results for query: {query[:60]}...")
    return out if out else None


def enrich_insights_with_research(
    summary: str,
    key_insights: list[str],
    max_queries: int = 2,
) -> list[dict]:
    """
    Use You.com Search to add citation-backed research insights.
    Builds search queries from summary/insights, fetches results, and returns
    a list of research items: { "insight": str, "url": str, "title": str }
    """
    if not YOUCOM_API_KEY:
        _log("YOUCOM_API_KEY not set; skipping enrichment")
        return []
    # Extract search queries from insights or summary (relaxed length: 10-150 chars)
    candidates = []
    for s in (key_insights or [])[:4]:
        s = (s or "").strip()
        if 10 <= len(s) <= 150:
            candidates.append(s)
    if not candidates and summary:
        first = (summary or "").split(". ")[0].strip()
        if len(first) >= 10:
            candidates.append(first)
    if not candidates and summary:
        # Fallback: use first ~80 chars of summary as search
        chunk = (summary or "")[:80].strip()
        if len(chunk) >= 15:
            candidates.append(chunk)
    if not candidates:
        _log("No search candidates from insights/summary; skipping You.com")
        return []
    _log(f"Search candidates: {candidates[:2]}")
    research_items = []
    seen_urls = set()
    for q in candidates[:max_queries]:
        results = search(q, count=2, freshness="month")
        if not results:
            continue
        for r in results:
            url_val = r.get("url") or ""
            if url_val in seen_urls:
                continue
            seen_urls.add(url_val)
            snippet = (r.get("snippet") or r.get("description") or "").strip()
            title = (r.get("title") or "Source").strip()
            if snippet:
                research_items.append({
                    "insight": snippet,
                    "url": url_val,
                    "title": title,
                })
        if len(research_items) >= 3:
            break
    _log(f"Enriched with {len(research_items)} research items from You.com")
    return research_items
