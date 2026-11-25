from ..core.config import settings


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


async def stream_text(messages):
    received = False
    async for chunk in get_llm().astream(messages):
        content = chunk.content
        blocks = [content] if isinstance(content, str) else content
        for block in blocks:
            value = block if isinstance(block, str) else block.get("text") if block.get("type") == "text" else None
            if value:
                received = True
                yield value
    if not received:
        raise ValueError("Empty model response")
