import json
from contextlib import aclosing
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from ..core.questions import questions
from .llm_factory import stream_text
from .llm_metrics import LlmStep
from .prompts import SYSTEM_PROMPT


def format_form_data(form_data):
    labels = {q.name: q.label for q in questions.base_questions + questions.advanced_questions}
    return "\n".join(f"{labels.get(k, k)}：{v.strip()}" for k, v in form_data.items() if v.strip())


def _build_lc_messages(messages):
    return [(HumanMessage if m.role == "user" else AIMessage)(content=m.content) for m in messages]


def _serialize_messages(messages):
    return [{"role": "user" if isinstance(m, HumanMessage) else "assistant", "content": m.content}
            for m in messages]


class ConversationService:
    async def _reply(self, conversation_id, history, step: LlmStep, system_prompt_override=None):
        parts = []
        messages = [SystemMessage(content=system_prompt_override or SYSTEM_PROMPT), *history]
        async with aclosing(stream_text(messages, step=step)) as stream:
            async for text in stream:
                parts.append(text)
                yield {"type": "chunk", "content": text}
        history.append(AIMessage(content="".join(parts)))
        yield {"type": "done", "conversation_id": str(conversation_id), "messages": _serialize_messages(history)}

    def start_conversation_stream(self, form_data):
        return self._reply(uuid4(), [HumanMessage(content=format_form_data(form_data))], LlmStep.CHAT_START)

    def start_summary_stream(self, summary, system_prompt_override=None):
        history = [HumanMessage(content=json.dumps(summary, ensure_ascii=False, indent=2))]
        return self._reply(uuid4(), history, LlmStep.CHAT_START, system_prompt_override)

    def continue_conversation_stream(self, request):
        history = _build_lc_messages(request.messages)
        history.append(HumanMessage(content=request.message))
        return self._reply(request.conversation_id, history, LlmStep.CHAT_CONTINUE, request.system_prompt_override)


conversation_service = ConversationService()
