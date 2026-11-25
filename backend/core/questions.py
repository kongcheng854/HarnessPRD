from .config import CORE_DIR
from ..api.schemas import QuestionsConfig

questions = QuestionsConfig.model_validate_json((CORE_DIR / "questions_config.json").read_bytes())
