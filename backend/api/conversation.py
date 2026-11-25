import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..core.questions import questions
from ..services.conversation_service import conversation_service
from ..services.document_service import document_service
from ..services.llm_factory import MissingKeyError
from .schemas import ContinueRequest, DocumentRequest, OptimizeRequest, QuestionsConfig, StartRequest, Transcript

router = APIRouter(prefix="/api/conversation", tags=["conversation"])
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _make_sse_generator(events):
    async def frames():
        try:
            async for event in events:
                yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
        except Exception as exc:
            logging.getLogger(__name__).warning("Stream failed (%s)", type(exc).__name__)
            message = str(exc) if isinstance(exc, MissingKeyError) else "模型请求失败，请检查服务连接、模型名称和密钥后重试。"
            yield "data: " + json.dumps({"type": "error", "message": message}, ensure_ascii=False) + "\n\n"
    return StreamingResponse(frames(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/questions", response_model=QuestionsConfig)
def get_questions():
    return questions


@router.post("/start-stream")
def start(request: StartRequest):
    for question in questions.base_questions + questions.advanced_questions:
        if question.required and not request.form_data.get(question.name, "").strip():
            raise HTTPException(422, f"请填写{question.label}")
    return _make_sse_generator(conversation_service.start_conversation_stream(request.form_data))


@router.post("/continue-stream")
def continue_chat(request: ContinueRequest):
    return _make_sse_generator(conversation_service.continue_conversation_stream(request))


@router.post("/generate-prd-stream")
def prd(request: Transcript):
    return _make_sse_generator(document_service.generate_prd_stream(request.messages))


@router.post("/generate-api-docs-stream")
def api_docs(request: DocumentRequest):
    return _make_sse_generator(document_service.generate_api_docs_stream(request.prd))


@router.post("/generate-prompts-stream")
def prompts(request: DocumentRequest):
    return _make_sse_generator(document_service.generate_prompts_stream(request.prd))


@router.post("/optimize-document-stream")
def optimize(request: OptimizeRequest):
    return _make_sse_generator(document_service.optimize_document_stream(request))
