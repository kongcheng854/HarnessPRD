from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: Text


class StartRequest(BaseModel):
    form_data: dict[str, str] = Field(min_length=1)


class Transcript(BaseModel):
    messages: list[Message] = Field(min_length=1)


class ContinueRequest(Transcript):
    conversation_id: UUID
    message: Text


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
