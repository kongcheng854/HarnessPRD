import logging
from contextlib import aclosing

from ..core.config import settings
from .llm_metrics import LlmStep, log_event, track_step


class MissingKeyError(ValueError):
    pass


def get_llm():
    anthropic = settings.default_llm_provider == "anthropic"
    key = settings.anthropic_api_key if anthropic else settings.openai_api_key
    if not key.get_secret_value().strip():
        raise MissingKeyError(f"请在 backend/.env 配置 {settings.default_llm_provider.upper()}_API_KEY 并重启后端。")
    if anthropic:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=settings.default_llm_model, api_key=key, streaming=True)
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=settings.default_llm_model, api_key=key, streaming=True)


class TrackedChatModel:
    def __init__(self, step: LlmStep):
        self.step = step

    async def ainvoke(self, messages, **kwargs):
        with track_step(self.step) as record:
            result = await get_llm().ainvoke(messages, **kwargs)
            record.observe(result)
            return result

    async def astream(self, messages, **kwargs):
        with track_step(self.step) as record:
            has_usage = False
            async with aclosing(get_llm().astream(messages, **kwargs)) as stream:
                async for chunk in stream:
                    has_usage = record.observe(chunk) or has_usage
                    yield chunk
            if not has_usage and settings.log_llm_metrics:
                log_event("llm_usage_missing", level=logging.DEBUG, step=self.step, model=record.model)


def get_tracked_llm(step: LlmStep) -> TrackedChatModel:
    return TrackedChatModel(step)


async def stream_text(messages, *, step: LlmStep):
    received = False
    async with aclosing(get_tracked_llm(step).astream(messages)) as stream:
        async for chunk in stream:
            content = chunk.content
            blocks = [content] if isinstance(content, str) else content
            for block in blocks:
                value = block if isinstance(block, str) else block.get("text") if block.get("type") == "text" else None
                if value:
                    received = True
                    yield value
    if not received:
        raise ValueError("Empty model response")
