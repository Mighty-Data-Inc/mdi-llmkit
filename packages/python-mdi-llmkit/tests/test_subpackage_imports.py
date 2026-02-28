import sys
import unittest
import importlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


class SubpackageImportTests(unittest.TestCase):
    def test_root_package_has_no_convenience_reexports(self):
        sys.modules.pop("mdi_llmkit.json_surgery", None)
        sys.modules.pop("mdi_llmkit.gpt_api", None)
        sys.modules.pop("mdi_llmkit.semanticMatch", None)
        sys.modules.pop("mdi_llmkit", None)

        mdi_llmkit = importlib.import_module("mdi_llmkit")

        self.assertEqual(mdi_llmkit.__all__, [])
        self.assertFalse(hasattr(mdi_llmkit, "GptConversation"))
        self.assertFalse(hasattr(mdi_llmkit, "json_surgery"))
        self.assertFalse(hasattr(mdi_llmkit, "compare_item_lists"))

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
