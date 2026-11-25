import asyncio
import logging
from contextlib import aclosing
from dataclasses import asdict

from ..core.config import settings
from .llm_metrics import LlmStep, RunMetricsCollector, log_event, track_step
from .model_registry import resolve_max_output
from .token_estimator import BudgetExceededError, check_budget, estimate_tokens


class MissingKeyError(ValueError):
    pass


def get_llm(model: str | None = None):
    model = model or settings.default_llm_model
    max_output = resolve_max_output(model)
    anthropic = settings.default_llm_provider == "anthropic"
    key = settings.anthropic_api_key if anthropic else settings.openai_api_key
    if not key.get_secret_value().strip():
        raise MissingKeyError(f"请在 backend/.env 配置 {settings.default_llm_provider.upper()}_API_KEY 并重启后端。")
    if anthropic:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=model, api_key=key, streaming=True, max_tokens=max_output)
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=model, api_key=key, base_url=settings.openai_base_url or None,
                      streaming=True, max_tokens=max_output)


class TrackedChatModel:
    def __init__(self, step: LlmStep):
        self.step = step
        self.model = settings.default_llm_model

    async def _preflight(self, messages):
        estimate = await asyncio.to_thread(estimate_tokens, messages, self.step, self.model)
        check = check_budget(estimate, self.step)
        run = RunMetricsCollector.current()
        if run is not None:
            run.budget = check
        if check.level != "ok":
            event = "token_budget_warn" if check.allowed else "token_budget_rejected"
            log_event(event, level=logging.WARNING, budget=asdict(check))
        if not check.allowed:
            raise BudgetExceededError(check)
        return check

    async def ainvoke(self, messages, **kwargs):
        budget = await self._preflight(messages)
        with track_step(self.step, budget) as record:
            result = await get_llm(self.model).ainvoke(messages, **kwargs)
            record.observe(result)
            return result

    async def astream(self, messages, **kwargs):
        budget = await self._preflight(messages)
        with track_step(self.step, budget) as record:
            has_usage = False
            async with aclosing(get_llm(self.model).astream(messages, **kwargs)) as stream:
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
