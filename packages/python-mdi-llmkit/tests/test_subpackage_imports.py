import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


class SubpackageImportTests(unittest.TestCase):
    def test_gpt_api_subpackage_exports(self):
        from mdi_llmkit.gpt_api import (  # noqa: PLC0415
            GptConversation,
            JSONSchemaFormat,
            gpt_submit,
        )

        self.assertTrue(callable(GptConversation))
        self.assertTrue(callable(JSONSchemaFormat))
        self.assertTrue(callable(gpt_submit))

    def test_json_surgery_subpackage_exports(self):
        from mdi_llmkit.json_surgery import json_surgery  # noqa: PLC0415

        self.assertTrue(callable(json_surgery))


if __name__ == "__main__":
    unittest.main()
