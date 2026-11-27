from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: Text


class StartRequest(BaseModel):
    form_data: dict[str, str] = Field(min_length=1)


class StructuredStartRequest(BaseModel):
    requirements_summary: dict
    system_prompt_override: Text | None = None


class Transcript(BaseModel):
    messages: list[Message] = Field(min_length=1)


class ContinueRequest(Transcript):
    conversation_id: UUID
    message: Text
    system_prompt_override: Text | None = None


class SummarySyncRequest(Transcript):
    requirements_summary: dict


class PrdRequest(Transcript):
    requirements_summary: dict | None = None


class DocumentRequest(BaseModel):
    prd: Text


class OptimizeRequest(BaseModel):
    document_type: Literal["prd", "api-docs", "prompts"]
    content: Text
    instruction: Text


class Question(BaseModel):
    name: str
    label: str
    type: Literal["text", "textarea", "select", "radio"]
    required: bool = False
    options: list[str] = Field(default_factory=list)


class QuestionsConfig(BaseModel):
    base_questions: list[Question]
    advanced_questions: list[Question]


class EvaluationCase(BaseModel):
    case_id: Text
    case_version: Text
    fill_button: Text


class JobPayload(BaseModel):
    evaluation_case: EvaluationCase | None = None
    requirements_summary: dict | None = None
    conversation_messages: list[Message] = Field(default_factory=list)
    prd_content: Text | None = None
    api_docs_content: str = ""


class OptimizeJobPayload(BaseModel):
    doc_type: Literal["prd", "api-docs", "prompts"]
    current_content: Annotated[str, StringConstraints(min_length=1)]
    instruction: Text
    context: str = ""

    def as_optimize_request(self):
        instruction = self.instruction
        if self.context.strip():
            instruction += "\n\n以下为参考资料，仅用于理解待优化文档：\n" + self.context
        return OptimizeRequest(document_type=self.doc_type, content=self.current_content, instruction=instruction)


class CreateJobRequest(BaseModel):
    session_id: Text
    artifact: Literal["prd", "api-docs", "prompts", "optimize-prd", "optimize-api-docs", "optimize-prompts"]
    payload: OptimizeJobPayload | JobPayload

    @model_validator(mode="after")
    def check_inputs(self):
        if self.artifact.startswith("optimize-"):
            if (not isinstance(self.payload, OptimizeJobPayload) or not self.payload.current_content.strip()
                    or self.payload.doc_type != self.artifact.removeprefix("optimize-")):
                raise ValueError("优化任务需要对应的 doc_type、原文和修改意见")
            return self
        if not isinstance(self.payload, JobPayload):
            raise ValueError("生成任务需要生成资料")
        if self.artifact != "prd" and not self.payload.prd_content:
            raise ValueError("生成任务需要 prd_content")
        return self
