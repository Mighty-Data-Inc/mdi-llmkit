import datetime
import json
import openai
import time

from typing import Any, Callable, Protocol, cast, Dict, List, Optional, Tuple, Union

from openai._types import Omit, omit
from openai.types.responses import EasyInputMessage, ResponseTextConfigParam


GPT_MODEL_CHEAP = "gpt-4.1-nano"
GPT_MODEL_SMART = "gpt-4.1"

_GPT_RETRY_LIMIT_DEFAULT = 5
_GPT_RETRY_BACKOFF_TIME_SECONDS_DEFAULT = 30  # seconds


class _ResponsesAPI(Protocol):
    def create(self, **kwargs: Any) -> Any: ...


class OpenAIClientLike(Protocol):
    @property
    def responses(self) -> _ResponsesAPI: ...


def current_datetime_system_message() -> Dict[str, str]:
    """Build a system message containing the current local date and time.

    This helper returns a message object in the OpenAI chat format
    (``{"role": ..., "content": ...}``) so it can be prepended to a
    conversation and provide the model with temporal context.

    Returns:
        Dict[str, str]: A system message with ``role`` set to ``"system"`` and
        ``content`` set to a !DATETIME string formatted as
        ``YYYY-MM-DD HH:MM:SS``.
    """
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    retval = {
        "role": "system",
        "content": f"!DATETIME: The current date and time is {current_time}",
    }
    return retval


def gpt_submit(
    messages: list,
    openai_client: OpenAIClientLike,
    *,
    model: Optional[str] = None,
    json_response: Optional[Union[bool, dict, str]] = None,
    system_announcement_message: Optional[str] = None,
    retry_limit: Optional[int] = None,
    retry_backoff_time_seconds: Optional[int] = None,
    warning_callback: Optional[Callable[[str], None]] = None,
) -> Union[str, dict, list]:
    if not model:
        model = GPT_MODEL_SMART

    if retry_limit is None:
        retry_limit = _GPT_RETRY_LIMIT_DEFAULT
    if retry_backoff_time_seconds is None:
        retry_backoff_time_seconds = _GPT_RETRY_BACKOFF_TIME_SECONDS_DEFAULT

    efail = None

    openai_text_param: ResponseTextConfigParam | Omit = omit
    if json_response:
        if isinstance(json_response, bool):
            openai_text_param = {"format": {"type": "json_object"}}
        elif isinstance(json_response, dict):
            # Deep copy to avoid modifying caller's object
            json_response = json.loads(json.dumps(json_response))

            openai_text_param = cast(ResponseTextConfigParam, json_response)
            # Check if format exists and has description before modifying
            if (
                "format" in openai_text_param
                and "description" in openai_text_param["format"]
            ):
                # Append instructions to the description to ensure JSON output.
                format_dict = openai_text_param["format"]
                if isinstance(format_dict, dict):
                    format_dict["description"] = format_dict.get("description", "")
                    format_dict["description"] += (
                        "\n\nABSOLUTELY NO UNICODE ALLOWED. Only use typeable keyboard characters. "
                        "Do not try to circumvent this rule with escape sequences, "
                        'backslashes, or other tricks. Use double dashes (--), straight quotes ("), '
                        "and single quotes (') instead of em-dashes, en-dashes, and curly versions."
                    )
                    format_dict["description"] = format_dict["description"].strip()

        elif isinstance(json_response, str):
            openai_text_param = json.loads(json_response)

    # Clear any existing datetime system message and add a fresh one.
    messages = [
        m
        for m in messages
        if not (
            type(m) is dict
            and m.get("role") == "system"
            and type(m.get("content")) is str
            and f"{m['content']}".startswith("!DATETIME:")
        )
    ]
    messages = [current_datetime_system_message()] + messages
    if system_announcement_message and system_announcement_message.strip():
        messages = [
            {
                "role": "system",
                "content": system_announcement_message.strip(),
            }
        ] + messages

    for iretry in range(retry_limit):
        llmreply = ""
        try:
            # Attempt to get a response from the OpenAI API
            llmresponse = openai_client.responses.create(
                model=model,
                input=messages,
                text=openai_text_param,
            )
            if llmresponse.error:
                if warning_callback:
                    warning_callback(
                        f"ERROR: OpenAI API returned an error: {llmresponse.error}"
                    )
            if llmresponse.incomplete_details:
                if warning_callback:
                    warning_callback(
                        "ERROR: OpenAI API returned incomplete details: "
                        f"{llmresponse.incomplete_details}"
                    )
            llmreply = llmresponse.output_text.strip()
            if not json_response:
                return f"{llmreply}"

            # If we got here, then we expect a JSON response,
            # which will be a dictionary or a list.
            # We'll use raw_decode rather than loads to parse it, because
            # GPT has a habit of concatenating multiple JSON objects
            # for some reason (raw_decode will stop at the end of the first object,
            # whereas loads will raise an error if there's any trailing text).
            (llmobj, _) = json.JSONDecoder().raw_decode(llmreply)
            llmobj: Union[dict, list] = llmobj
            return llmobj
        except openai.OpenAIError as e:
            efail = e
            if warning_callback:
                warning_callback(
                    f"OpenAI API error:\n\n{e}.\n\n"
                    f"Retrying (attempt {iretry + 1} of {retry_limit}) "
                    f"in {retry_backoff_time_seconds} seconds..."
                )
            time.sleep(retry_backoff_time_seconds)
        except json.JSONDecodeError as e:
            efail = e
            if warning_callback:
                warning_callback(
                    f"JSON decode error:\n\n{e}.\n\n"
                    f"Raw text of LLM Reply:\n{llmreply}\n\n"
                    f"Retrying (attempt {iretry + 1} of {retry_limit}) immediately..."
                )

    # Propagate the last error after all retries
    if efail:
        raise efail
    raise ValueError("Unknown error occurred in _gpt_helpers")
