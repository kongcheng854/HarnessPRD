import json
import logging
from contextlib import aclosing
from copy import deepcopy
from langchain_core.messages import HumanMessage, SystemMessage
import yaml

from ..core.requirements_schema import load_requirements_schema, validate_summary
from . import api_docs_review_agent, prompts_review_agent
from .conversation_service import _build_lc_messages
from .llm_factory import stream_text
from .llm_metrics import LlmStep, RunMetricsCollector
from .prompts import (API_DOCS_GENERATION_PROMPT, OPTIMIZE_DOCUMENT_PROMPT_TEMPLATE,
                      PRD_GENERATION_PROMPT, PROMPTS_GENERATION_PROMPT)
from .skill_loader import bundle_to_injected_meta, compose_prompt_sections, load_skill_bundle

logger = logging.getLogger(__name__)

SYNC_PROMPT = """依据当前摘要与澄清访谈，仅回填用户明确补充、确认或纠正的内容。
助手提出的建议只有得到用户明确确认后才可采用。有疑问保留原值。
返回 JSON 数组，每项包含 path（字段名数组）、value（新值）、evidence（用户原话的连续片段）。
只修改 Schema 已定义的叶字段；数组字段返回包含所有保留项的完整数组。
仅当用户明确要求取消某项时用 null 删除可选字段。没有变更返回 []。"""


PROMPT_SECTION_ORDER = ("instructions", "reference", "template", "schema", "example")


class SkillArtifactError(RuntimeError):
    pass


def _load_skill_prompt(artifact: str, base_prompt: str) -> tuple[str, list[dict[str, object]]]:
    try:
        bundle = load_skill_bundle(artifact)
    except (OSError, ValueError, yaml.YAMLError) as exc:
        raise SkillArtifactError(f"{artifact} Skill 配置有误，请检查 config/skills.yaml 与 skill.yaml：{exc}") from exc
    if not bundle.artifacts:
        raise SkillArtifactError(f"{artifact} Skill 未加载到任何文件，请检查项目文件。")
    grouped = compose_prompt_sections(bundle)
    sections = [base_prompt]
    sections.extend(grouped[role] for role in PROMPT_SECTION_ORDER if role in grouped)
    sections.extend(text for role, text in grouped.items() if role not in PROMPT_SECTION_ORDER)
    return "\n\n".join(sections), bundle_to_injected_meta(bundle)


def _build_prd_prompt() -> str:
    prompt, _ = _load_skill_prompt("prd", PRD_GENERATION_PROMPT)
    return prompt


class DocumentService:
    async def _generate(self, template, inputs, step: LlmStep):
        async with aclosing(stream_text([SystemMessage(content=template), *inputs], step=step)) as stream:
            async for text in stream:
                yield {"type": "chunk", "content": text}
        yield {"type": "done"}

    async def sync_summary_from_conversation(self, summary, messages):
        schema = load_requirements_schema()
        # 结构化会话的首条消息是初始表单，只有后续用户发言可作为修订依据。
        history = list(messages)
        try:
            initial = json.loads(history[0].content)
        except ValueError:
            initial = None
        structured = isinstance(initial, dict) and "mvp_features" in initial
        validate_summary(summary, partial=not structured)
        if structured:
            history = history[1:]
        user_texts = [m.content for m in history if m.role == "user"]
        if not user_texts:
            return summary

        payload = {"schema": schema, "current_summary": summary, "history": [m.model_dump() for m in history]}
        inputs = [SystemMessage(content=SYNC_PROMPT), HumanMessage(content=json.dumps(payload, ensure_ascii=False))]
        output = "".join([text async for text in stream_text(inputs, step=LlmStep.SUMMARY_SYNC)]).strip()
        updates = json.loads(output.removeprefix("```json").removesuffix("```").strip())
        if not isinstance(updates, list):
            raise ValueError("摘要修订必须为数组")
        candidate = deepcopy(summary)
        for change in updates:
            if not isinstance(change, dict) or not {"path", "value", "evidence"} <= change.keys():
                raise ValueError("摘要修订格式无效")
            path, value, evidence = change["path"], change["value"], change["evidence"]
            if not isinstance(evidence, str) or not evidence.strip() or not any(evidence in s for s in user_texts):
                continue
            if not isinstance(path, list) or not 1 <= len(path) <= 2 or not all(isinstance(k, str) for k in path):
                raise ValueError("摘要字段路径无效")
            node = schema
            for key in path:
                node = node.get("properties", {}).get(key, {})
            if not node or "properties" in node:
                raise ValueError("摘要修订引用了未知字段或字段组")
            if value is None and len(path) == 2 and path[0] not in candidate:
                continue
            parent = candidate if len(path) == 1 else candidate.setdefault(path[0], {})
            if value is None:
                parent.pop(path[-1], None)
            else:
                parent[path[-1]] = value
        validate_summary(candidate, partial=not structured)
        return candidate

    async def generate_prd_stream(self, messages, requirements_summary=None):
        request = "请根据以上访谈生成 PRD。"
        if requirements_summary is not None:
            request += "以下是用户审核后的需求摘要；如与访谈冲突，以摘要为准。\n" + json.dumps(requirements_summary, ensure_ascii=False)
        inputs = [*_build_lc_messages(messages), HumanMessage(content=request)]
        prompt, skills = _load_skill_prompt("prd", PRD_GENERATION_PROMPT)
        run = RunMetricsCollector.current()
        if run is not None:
            run.injected_skills = skills
        async with aclosing(self._generate(prompt, inputs, LlmStep.PRD_WRITER)) as stream:
            async for event in stream:
                yield event

    def generate_api_docs_stream(self, prd):
        prompt, skills = _load_skill_prompt("api-docs", API_DOCS_GENERATION_PROMPT)
        run = RunMetricsCollector.current()
        if run is not None:
            run.injected_skills = skills
        return self._generate(prompt, [HumanMessage(content=prd)], LlmStep.API_DOCS_GENERATE)

    def generate_prompts_stream(self, prd):
        prompt, skills = _load_skill_prompt("prompts", PROMPTS_GENERATION_PROMPT)
        run = RunMetricsCollector.current()
        if run is not None:
            run.injected_skills = skills
        return self._generate(prompt, [HumanMessage(content=prd)], LlmStep.PROMPTS_GENERATE)

    async def review_downstream(self, artifact, payload, content):
        if artifact == "api-docs":
            guidelines, _ = _load_skill_prompt("api-docs", API_DOCS_GENERATION_PROMPT)
            return await api_docs_review_agent.review(payload.prd_content, content, guidelines)
        return await prompts_review_agent.review(payload.prd_content, payload.api_docs_content, content)

    def optimize_document_stream(self, request):
        artifact = "optimize-" + request.document_type
        base = OPTIMIZE_DOCUMENT_PROMPT_TEMPLATE.format(document_type=request.document_type)
        prompt, skills = _load_skill_prompt(artifact, base)
        run = RunMetricsCollector.current()
        if run is not None:
            run.injected_skills = skills
        inputs = [HumanMessage(content=f"原文：\n{request.content}\n修改要求：\n{request.instruction}")]
        return self._generate(prompt, inputs, LlmStep.DOCUMENT_OPTIMIZE)


document_service = DocumentService()
