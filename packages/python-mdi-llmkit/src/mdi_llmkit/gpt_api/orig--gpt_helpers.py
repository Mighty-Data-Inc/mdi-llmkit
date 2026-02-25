import datetime
import json
import openai
import time

from typing import Any, cast, Dict, List, Optional, Tuple, Union

from openai._types import Omit, omit
from openai.types.responses import ResponseTextConfigParam

GPT_MODEL_CHEAP = "gpt-4.1-nano"
GPT_MODEL_SMART = "gpt-4.1"

GPT_RETRY_LIMIT = 5
GPT_RETRY_BACKOFF_TIME_SECONDS = 30  # seconds

SYSTEM_ANNOUNCEMENT_MESSAGE: str = ""


def gpt_submit(
    messages: list,
    openai_client: openai.OpenAI,
    model: Optional[str] = None,
    json_response: Optional[Union[bool, dict, str]] = None,
) -> Union[str, dict, list]:
    if not model:
        model = GPT_MODEL_SMART

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
                if isinstance(format_dict, dict) and "description" in format_dict:
                    format_dict["description"] += (
                        "\n\nABSOLUTELY NO UNICODE ALLOWED. Only use typeable keyboard characters. "
                        "Do not try to circumvent this rule with escape sequences, "
                        'backslashes, or other tricks. Use double dashes (--), straight quotes ("), '
                        "and single quotes (') instead of em-dashes, en-dashes, and curly versions."
                    )
        elif isinstance(json_response, str):
            openai_text_param = json.loads(json_response)

    # Clear any existing datetime system message and add a fresh one.
    messages = [
        m
        for m in messages
        if not (
            m.get("role") == "system"
            and type(m.get("content")) is str
            and m.get("content", "").startswith("DATETIME:")
        )
    ]
    messages = [current_datetime_system_message()] + messages
    if SYSTEM_ANNOUNCEMENT_MESSAGE and SYSTEM_ANNOUNCEMENT_MESSAGE.strip():
        messages = [
            {
                "role": "system",
                "content": SYSTEM_ANNOUNCEMENT_MESSAGE.strip(),
            }
        ] + messages

    for iretry in range(GPT_RETRY_LIMIT):
        llmreply = ""
        try:
            # Attempt to get a response from the OpenAI API
            llmresponse = openai_client.responses.create(
                model=model,
                input=messages,
                text=openai_text_param,
            )
            if llmresponse.error:
                print("ERROR: OpenAI API returned an error:", llmresponse.error)
            if llmresponse.incomplete_details:
                print(
                    "ERROR: OpenAI API returned incomplete details:",
                    llmresponse.incomplete_details,
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
            print(
                f"OpenAI API error:\n\n{e}.\n\n"
                f"Retrying (attempt {iretry + 1} of {GPT_RETRY_LIMIT}) "
                f"in {GPT_RETRY_BACKOFF_TIME_SECONDS} seconds..."
            )
            time.sleep(GPT_RETRY_BACKOFF_TIME_SECONDS)
        except json.JSONDecodeError as e:
            efail = e
            print(
                f"JSON decode error:\n\n{e}.\n\n"
                f"Raw text of LLM Reply:\n{llmreply}\n\n"
                f"Retrying (attempt {iretry + 1} of {GPT_RETRY_LIMIT}) immediately..."
            )

    # Propagate the last error after all retries
    if efail:
        raise efail
    raise ValueError("Unknown error occurred in _gpt_helpers")


class GptConversation(list):
    """A conversation class that behaves like a list but with additional methods for managing chat messages."""

    def __init__(
        self,
        messages=None,
        *,
        openai_client: Optional[openai.OpenAI] = None,
        model: Optional[str] = None,
    ):
        """Initialize conversation with optional list of messages."""
        super().__init__(messages or [])
        self.openai_client = openai_client
        self.model = model

        self.last_reply = None

    def assign_messages(self, messages=None):
        """Assign a list of messages to the conversation."""
        self.clear()
        if messages:
            self.extend(messages)
        return self

    def clone(self):
        """Create a copy of the conversation."""
        return GptConversation(
            messages=json.loads(json.dumps(list(self))),
            openai_client=self.openai_client,
            model=self.model,
        )

    def submit(
        self,
        message: Optional[Union[str, dict]] = None,
        role: Optional[str] = "user",
        *,
        model: Optional[str] = None,
        json_response: Optional[Union[bool, dict, str]] = None,
    ) -> Any:
        """Submit a message to the OpenAI API and return the response."""
        if not self.openai_client:
            raise ValueError(
                "OpenAI client is not set. Please provide an OpenAI client."
            )
        if not model:
            model = self.model or GPT_MODEL_SMART

        if message:
            if isinstance(message, dict):
                if not json_response and "format" in message:
                    json_response = message

                if not role and "role" in message:
                    role = message["role"]

                if "content" in message:
                    message = message.get("content", "")

            self.add_message(
                role=role or "user",
                content=message,
            )

        llmreply = gpt_submit(
            messages=self.to_dict_list(),
            openai_client=self.openai_client,
            json_response=json_response,
            model=model,
        )

        self.add_assistant_message(llmreply)
        self.last_reply = llmreply
        return llmreply

    def add_message(self, role: str, content: Any) -> "GptConversation":
        """Add a message to the conversation."""
        if not isinstance(content, str):
            content = (
                json.dumps(content, indent=2)
                if isinstance(content, dict)
                else str(content)
            )
        self.append({"role": role, "content": content})
        return self

    def add_user_message(self, content: Any) -> "GptConversation":
        """Add a user message to the conversation."""
        return self.add_message("user", content)

    def add_assistant_message(self, content: Any) -> "GptConversation":
        """Add an assistant message to the conversation."""
        return self.add_message("assistant", content)

    def add_system_message(self, content: Any) -> "GptConversation":
        """Add a system message to the conversation."""
        return self.add_message("system", content)

    def add_developer_message(self, content: Any) -> "GptConversation":
        """Add a developer message to the conversation."""
        return self.add_message("developer", content)

    def submit_message(self, role: str, content: Any) -> Any:
        """Add a message to the conversation and submit it."""
        self.add_message(role, content)
        retval = self.submit()
        return retval

    def submit_user_message(self, content: Any) -> Any:
        """Add a user message to the conversation and submit it."""
        self.add_user_message(content)
        retval = self.submit()
        return retval

    def submit_assistant_message(self, content: Any) -> Any:
        """Add an assistant message to the conversation and submit it."""
        self.add_assistant_message(content)
        retval = self.submit()
        return retval

    def submit_system_message(self, content: Any) -> Any:
        """Add a system message to the conversation and submit it."""
        self.add_system_message(content)
        retval = self.submit()
        return retval

    def submit_developer_message(self, content: Any) -> Any:
        """Add a developer message to the conversation and submit it."""
        self.add_developer_message(content)
        retval = self.submit()
        return retval

    def get_last_message(self) -> Optional[dict]:
        """Get the last message in the conversation."""
        return self[-1] if self else None

    def get_messages_by_role(self, role: str) -> List[dict]:
        """Get all messages from a specific role."""
        return [msg for msg in self if msg.get("role") == role]

    def get_last_reply_str(self) -> str:
        """Return the last reply as a string (useful for API calls)."""
        if type(self.last_reply) is not str:
            return ""
        return self.last_reply

    def get_last_reply_dict(self) -> Dict[str, Any]:
        """Return a clone of the last reply as a dictionary (useful for API calls)."""
        if type(self.last_reply) is not dict:
            return {}
        return json.loads(json.dumps(self.last_reply))

    def get_last_reply_dict_field(self, fieldname: str, default: Any = None) -> Any:
        """Return a specific field from the last reply dictionary (or None if not found)."""
        if type(self.last_reply) is not dict:
            return None
        return self.last_reply.get(fieldname, default)

    def to_dict_list(self) -> List[dict]:
        """Return the conversation as a list of dictionaries (useful for API calls)."""
        return list(self)
