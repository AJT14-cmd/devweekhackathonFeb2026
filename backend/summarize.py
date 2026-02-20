"""
Summarize a meeting transcript.
Uses You.com Express Agent when YOUCOM_API_KEY is set; otherwise returns a local fallback
(first 500 chars as summary, empty key_insights/decisions/action_items).
"""

from youcom import summarize_with_agent, _summarize_via_search_only


def summarize_transcript(transcript: str) -> dict | None:
    """
    Return a dict with keys: summary, key_insights, decisions, action_items, research_insights, summary_source.
    Tries You.com Agent first; on missing key or error, returns local fallback (never None for non-empty transcript).
    """
    if not (transcript or "").strip() or len((transcript or "").strip()) < 50:
        return None
    result = summarize_with_agent(transcript)
    if result:
        return result
    return _summarize_via_search_only(transcript)
