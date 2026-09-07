from __future__ import annotations

import os

from .openai import OpenAIProvider


class XAIProvider(OpenAIProvider):
    name = "xai"
    structured_responses = True

    def __init__(self) -> None:
        super().__init__()
        self.api_key = os.environ.get("XAI_API_KEY", "")
        self.model = os.environ.get("ATLAS_XAI_MODEL", "")
        self.base_url = os.environ.get("ATLAS_XAI_BASE_URL", "https://api.x.ai/v1")
        self.input_rate = float(os.environ.get("ATLAS_XAI_INPUT_USD_PER_M", "0"))
        self.output_rate = float(os.environ.get("ATLAS_XAI_OUTPUT_USD_PER_M", "0"))

    def available(self) -> tuple[bool, str | None]:
        if not self.api_key:
            return False, "XAI_API_KEY is not configured"
        if not self.model:
            return False, "ATLAS_XAI_MODEL is not configured"
        return True, None
