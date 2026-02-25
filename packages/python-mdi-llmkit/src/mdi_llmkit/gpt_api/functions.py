from typing import Any, Dict, List, Optional, Union
import datetime


def current_datetime_system_message() -> Dict[str, str]:
    """Build a system message containing the current local date and time.

    This helper returns a message object in the OpenAI chat format
    (``{"role": ..., "content": ...}``) so it can be prepended to a
    conversation and provide the model with temporal context.

    Returns:
        Dict[str, str]: A system message with ``role`` set to ``"system"`` and
        ``content`` set to a DATETIME string formatted as
        ``YYYY-MM-DD HH:MM:SS``.
    """
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    retval = {
        "role": "system",
        "content": f"DATETIME: The current date and time is {current_time}",
    }
    return retval
