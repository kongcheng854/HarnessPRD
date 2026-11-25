import json
import logging
from contextlib import aclosing
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from ..core.questions import questions
from ..core import request_context
from ..core.requirements_schema import load_requirements_schema, validate_summary
from ..services.conversation_service import conversation_service
from ..services.document_service import SkillArtifactError, document_service
from ..services.llm_factory import MissingKeyError
from ..services.llm_metrics import RunMetricsCollector
from ..services.token_estimator import BudgetExceededError
from .schemas import (ApiDocsRequest, ContinueRequest, DocumentRequest, OptimizeRequest,
                      PrdRequest, QuestionsConfig, RagHit, RetrievalRequest, StartRequest,
                      StructuredStartRequest, SummarySyncRequest)

router = APIRouter(prefix="/api/conversation", tags=["conversation"])
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class _RunStreamingResponse(StreamingResponse):
    async def stream_response(self, send):
        # A disconnect during send can leave the iterator suspended at a yield.
        async with aclosing(self.body_iterator):
            await super().stream_response(send)


def _frame(event):
    return "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"


def _make_sse_generator(events, run_type):
    async def frames():
        terminal = None
        with RunMetricsCollector.start(run_type) as run:
            try:
                async with aclosing(events):
                    async for event in events:
                        if event["type"] in ("done", "error"):
                            terminal = dict(event)
                            run.revision_applied = event.get("revision_applied")
                            break
                        yield _frame(event)
            except BudgetExceededError as exc:
                terminal = {"type": "error", "code": exc.code, "message": str(exc), "budget": asdict(exc.check)}
            except Exception as exc:
                message = str(exc) if isinstance(exc, (MissingKeyError, SkillArtifactError)) else "模型请求失败，请检查服务连接、模型名称和密钥后重试。"
                terminal = {"type": "error", "message": message}
        yield _frame({"type": "run_summary", **asdict(run.finish())})
        if terminal is not None:
            if terminal["type"] == "error":
                terminal["request_id"] = request_context.request_id.get()
            elif run_type in ("chat_start", "chat_continue") and run.budget is not None:
                terminal["context_usage"] = run.budget.context_usage()
            yield _frame(terminal)
            if terminal.get("code") == BudgetExceededError.code:
                yield "data: [DONE]\n\n"
    return _RunStreamingResponse(frames(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/questions", response_model=QuestionsConfig)
def get_questions():
    return questions


@router.get("/requirements-schema")
def requirements_schema():
    return load_requirements_schema()


@router.post("/start-stream")
def start(request: StructuredStartRequest | StartRequest):
    if isinstance(request, StructuredStartRequest):
        try:
            validate_summary(request.requirements_summary)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        events = conversation_service.start_summary_stream(request.requirements_summary, request.system_prompt_override)
        return _make_sse_generator(events, "chat_start")
    for question in questions.base_questions + questions.advanced_questions:
        if question.required and not request.form_data.get(question.name, "").strip():
            raise HTTPException(422, f"请填写{question.label}")
    return _make_sse_generator(conversation_service.start_conversation_stream(request.form_data), "chat_start")


@router.post("/continue-stream")
def continue_chat(request: ContinueRequest):
    return _make_sse_generator(conversation_service.continue_conversation_stream(request), "chat_continue")


@router.post("/sync-summary-from-conversation")
async def sync_summary(request: SummarySyncRequest):
    try:
        with RunMetricsCollector.start("summary_sync") as run:
            summary = await document_service.sync_summary_from_conversation(request.requirements_summary, request.messages)
    except BudgetExceededError as exc:
        return JSONResponse(status_code=422, content={"code": exc.code, "detail": str(exc), "budget": asdict(exc.check),
                                                     "request_id": request_context.request_id.get()})
    except MissingKeyError as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, "摘要校验失败，请检查需求内容或重试回填。") from exc
    except Exception as exc:
        logging.getLogger(__name__).warning("Summary sync failed (%s)", type(exc).__name__)
        raise HTTPException(502, "模型回填失败，请重试。") from exc
    return {"requirements_summary": summary, "run_summary": asdict(run.finish())}


@router.post("/retrieve-api-docs-rag", response_model=list[RagHit])
def retrieve_api_docs_rag(request: RetrievalRequest):
    return document_service.retrieve_api_docs_rag_hits(request.prd, request.messages)


@router.post("/generate-prd-stream")
def prd(request: PrdRequest):
    return _make_sse_generator(document_service.generate_prd_stream(request.messages, request.requirements_summary), "generate_prd")


@router.post("/generate-api-docs-stream")
def api_docs(request: ApiDocsRequest):
    return _make_sse_generator(document_service.generate_api_docs_stream(request.prd, request.rag_hits), "generate_api_docs")


@router.post("/generate-prompts-stream")
def prompts(request: DocumentRequest):
    return _make_sse_generator(document_service.generate_prompts_stream(request.prd), "generate_prompts")


@router.post("/optimize-document-stream")
def optimize(request: OptimizeRequest):
    return _make_sse_generator(document_service.optimize_document_stream(request), "optimize_document")
