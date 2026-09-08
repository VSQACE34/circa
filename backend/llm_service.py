"""LLM wrapper using emergentintegrations universal key."""
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# Map friendly model ids to (provider, model)
MODEL_MAP = {
    "claude-sonnet-4-6": ("anthropic", "claude-sonnet-4-6"),
    "gpt-5.4": ("openai", "gpt-5.4"),
    "gemini-3.1-pro-preview": ("gemini", "gemini-3.1-pro-preview"),
}


def resolve_model(model: str, provider: str = ""):
    if model in MODEL_MAP:
        return MODEL_MAP[model]
    if provider:
        return (provider, model)
    return ("anthropic", "claude-sonnet-4-6")


def _chat(session_id: str, system_message: str, model: str, provider: str = ""):
    prov, mdl = resolve_model(model, provider)
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_message,
    ).with_model(prov, mdl)
    return chat


async def stream_reply(session_id, system_message, user_text, model, provider="", history=None):
    """Async generator yielding text deltas."""
    chat = _chat(session_id, system_message, model, provider)
    # Prepend history into the prompt for context (library manages per-session but we pass explicit history)
    prompt = user_text
    if history:
        convo = "\n".join([f"{m['role']}: {m['content']}" for m in history])
        prompt = f"Conversation so far:\n{convo}\n\nUser: {user_text}"
    async for event in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(event, TextDelta):
            yield event.content
        elif isinstance(event, StreamDone):
            break


async def complete(session_id, system_message, user_text, model, provider=""):
    """Non-streaming full completion (used for analysis)."""
    chat = _chat(session_id, system_message, model, provider)
    out = []
    async for event in chat.stream_message(UserMessage(text=user_text)):
        if isinstance(event, TextDelta):
            out.append(event.content)
        elif isinstance(event, StreamDone):
            break
    return "".join(out)
