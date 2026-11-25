from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

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


class RagHit(BaseModel):
    source: Text
    title: Text
    content: Text


class RetrievalRequest(DocumentRequest):
    messages: list[Message]


class ApiDocsRequest(DocumentRequest):
    rag_hits: list[RagHit] = Field(default_factory=list)


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
