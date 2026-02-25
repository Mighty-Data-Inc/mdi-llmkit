import datetime
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.gpt_api.functions import current_datetime_system_message


class FunctionsTests(unittest.TestCase):
    def test_current_datetime_system_message(self):
        current_dt = datetime.datetime.now()

        result = current_datetime_system_message()

        self.assertEqual(result["role"], "system")

        # Allow a one-second rollover because the function call may happen
        # just after crossing a second boundary from when current_dt is captured.
        expected_content_options = {
            f"DATETIME: The current date and time is {current_dt.strftime('%Y-%m-%d %H:%M:%S')}",
            f"DATETIME: The current date and time is {(current_dt + datetime.timedelta(seconds=1)).strftime('%Y-%m-%d %H:%M:%S')}",
        }
        self.assertIn(result["content"], expected_content_options)


if __name__ == "__main__":
    unittest.main()
