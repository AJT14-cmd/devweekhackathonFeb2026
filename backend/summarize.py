"""
Summarize a meeting transcript using You.com APIs.
- Agents API: Summarizes transcript with web search grounding
- Search API: Adds citation-backed research insights
Requires YOUCOM_API_KEY in .env (get one at https://you.com/platform).
"""
import sys
import os

# #region agent log
def _dbg(hid: str, msg: str, **data):
    try:
        import json
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "debug-c21db1.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps({"sessionId":"c21db1","hypothesisId":hid,"location":"summarize.py","message":msg,"data":data,"timestamp":__import__("time").time()*1000}) + "\n")
    except Exception:
        pass
# #endregion

def _log(msg: str) -> None:
    print(f"[summarize] {msg}", flush=True)


def summarize_transcript(transcript: str) -> dict | None:
    """
    Return a dict with keys: summary, key_insights, decisions, action_items, research_insights.
    Uses You.com Agents API + Search. Returns None if YOUCOM_API_KEY not set or on error.
    """
    # #region agent log
    _dbg("H2", "summarize_transcript called", transcript_len=len((transcript or "").strip()))
    # #endregion
    transcript = (transcript or "").strip()
    if not transcript or len(transcript) < 50:
        _log("Transcript too short to summarize")
        return None

    try:
        from youcom import summarize_with_agent, _summarize_via_search_only
        result = summarize_with_agent(transcript)
        if result:
            _log(f"Summarization done: summary={len(result.get('summary', ''))} chars, insights={len(result.get('key_insights', []))}, research={len(result.get('research_insights', []))}")
            return result
        # Agent failed or no API key: use non-copy fallback instead of returning None
        fallback = _summarize_via_search_only(transcript)
        _log("Using fallback summary (no transcript copy)")
        return fallback
    except Exception as e:
        _log(f"Summarization failed: {type(e).__name__}: {e}")
        if hasattr(sys, "stderr"):
            import traceback
            traceback.print_exc(file=sys.stderr)
        try:
            from youcom import _summarize_via_search_only
            return _summarize_via_search_only(transcript)
        except Exception:
            return None
