from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from ..core.questions import questions
from .llm_factory import stream_text
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
    async def _reply(self, conversation_id, history):
        parts = []
        async for text in stream_text([SystemMessage(content=SYSTEM_PROMPT), *history]):
            parts.append(text)
            yield {"type": "chunk", "content": text}
        history.append(AIMessage(content="".join(parts)))
        yield {"type": "done", "conversation_id": str(conversation_id), "messages": _serialize_messages(history)}

    def start_conversation_stream(self, form_data):
        return self._reply(uuid4(), [HumanMessage(content=format_form_data(form_data))])

    def continue_conversation_stream(self, request):
        history = _build_lc_messages(request.messages)
        history.append(HumanMessage(content=request.message))
        return self._reply(request.conversation_id, history)


conversation_service = ConversationService()
