from langchain_core.messages import HumanMessage, SystemMessage

from .conversation_service import _build_lc_messages
from .llm_factory import stream_text
from .prompts import (API_DOCS_GENERATION_PROMPT, OPTIMIZE_DOCUMENT_PROMPT_TEMPLATE,
                      PRD_GENERATION_PROMPT, PROMPTS_GENERATION_PROMPT)


class DocumentService:
    async def _generate(self, template, inputs):
        async for text in stream_text([SystemMessage(content=template), *inputs]):
            yield {"type": "chunk", "content": text}
        yield {"type": "done"}

    def generate_prd_stream(self, messages):
        return self._generate(PRD_GENERATION_PROMPT, [
            *_build_lc_messages(messages), HumanMessage(content="请根据以上访谈生成 PRD。")])

    def generate_api_docs_stream(self, prd):
        return self._generate(API_DOCS_GENERATION_PROMPT, [HumanMessage(content=prd)])

    def generate_prompts_stream(self, prd):
        return self._generate(PROMPTS_GENERATION_PROMPT, [HumanMessage(content=prd)])

    def optimize_document_stream(self, request):
        template = OPTIMIZE_DOCUMENT_PROMPT_TEMPLATE.format(document_type=request.document_type)
        return self._generate(template, [HumanMessage(content=f"原文：\n{request.content}\n修改要求：\n{request.instruction}")])


document_service = DocumentService()
