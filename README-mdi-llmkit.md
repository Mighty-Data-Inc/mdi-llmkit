# Integrating AI into Production Software

Everybody’s excited right now about using AI to *write code*. Tools like Claude Code, GPT Codex, and GitHub Copilot drive faster development cycles and even let non-developers spin up their own apps. That’s great for productivity -- but it misses the bigger opportunity.

> **LLMs shouldn’t just write software. They should make software _be smarter_.**

Business data is rarely clean. Documents contain typos, inconsistent terminology, ambiguous phrasing, and units that don’t quite match.

Humans read through this noise without difficulty. **Humans can infer what the data *means*. Software cannot -- not unless it incorporates AI.** That doesnt simply mean software that was _written by_ AI. That means software that _uses_ AI as part of its execution flow.

Consider a few actual field cases that Mighty Data, Inc. enountered with real-world clients:

- An invoice system for home renovation projects tried to order **5,000 buckets of beige paint**, when what the user meant was enough paint to cover **5,000 square feet of interior wall**. In a field titled "Paint (Qty: buckets)", they entered "5000 sqft". Any human contractor in the industry would've known what they meant. Without integrated AI, the invoicing software had no clue.
- A residential property listing claimed that a single-family home had **212 bathrooms** because someone typed **“2 1/2”**.  
- A builder needed to obey a lein on **“the 10-acre square at the northwestern corner of the Johnson family farm,”** requiring contextual reasoning to determine the actual geographic location being referenced and find it on a map using objectively discernible latitude and longitude coordinates.

To compensate for real-world messiness, conventional systems often accumulate large amounts of “cleanup” code: special cases for known bad inputs, regexes for common formatting errors, missing-data imputations, and other custom sanity-checks meant to sanitize dirty data before the real logic can run.

**Traditional software handles dirty data by piling on brittle heuristics.**

This works, up to a point. But it only handles problems the programmer already anticipated. When something new appears -- an unfamiliar phrasing, a strange unit, or a subtle inconsistency -- the system has no idea what to do with it. The system either passes the wrong number down the pipeline without a second thought, or it tries to "correct" it _incorrectly_, which just makes the problem worse.

That's where LLM integration comes in.

LLMs make it possible to build systems that can interpret inputs, resolve ambiguity, and detect contextual anomalies before they propagate downstream.

**Software with LLM integration can finally meet the real world where it actually is.**

So. If LLMs make software so much more capable, then _why isn’t every application already using them_?

The reason is simple: because LLM technology simply wasn't invented, nor presented to the user public, in a business-forward manner.

> **Integrating LLMs into real software is surprisingly awkward.**

Most LLM tooling today is optimized for chat interfaces, coding assistants, or quick demos. The sample apps for popular LLM services such as GPT tend to assume a use case in which there's a human sitting at a keyboard, typing questions and reading replies.

The vast majority of production-grade software doesn’t work that way. Applications seldom follow a language-first interaction modality. At the enterprise level, applications need to function autonomously. They need sanitized inputs, structured outputs, predictable behavior, and repeatable control. They need systems that can manage multi-step reasoning, perform contextual inference, and integrate results into ordinary application logic.

This is where many teams run into trouble. The moment you try to move beyond a toy example, the integration surface gets messy. Developers end up reinventing the same multi-stage conversation management logic over and over again -- or they choose not to use multi-stage conversation methods at all. They perform the same cleanup tasks repeatedly to parse the LLM's output and handle unexpected response structures. They resort to more and more "creative" approaches to prompt engineering with ever-increasing levels of desperation. In short:

**Developers end up reinventing the same LLM usage "glue" over and over again.**

That’s the problem space this toolkit addresses.

Instead of treating LLMs like a chatbot bolted onto the side of your system, the **Mighty Data, Inc. LLM Kit** provides utilities for integrating them as structured components inside real applications: managing multi-shot conversations, working with structured outputs, and building systems where model reasoning can be incorporated cleanly into ordinary software workflows.

> **The Mighty Data, Inc. LLM Kit provides the infrastructure needed to invoke LLMs reliably in production-grade application logic.**

---

# 1. The Problem: Free-Form LLM Responses Break Deterministic Workflows

Professional software engineering teams need predictable, auditable, structured outputs that plug into existing procedural software pipelines. Unfortunately, LLMs naturally return probabilistic free-form text, which creates integration risk, brittle post-processing logic, and high maintenance overhead.

## 1.1. Free-Form Text vs. Structured Systems

Large language models are powerful tools. They're great at reading text, summarizing information, and extracting specific pieces of data from natural-language documents.

However, they have one major limitation: **they produce free-form text**. Above all else, their training emphasizes _natural language_ token sequences.

Software systems, on the other hand, require **structured data**.

This mismatch creates difficulties when developers attempt to integrate LLMs into production-grade deliverables.

The approach most commonly taken by most developers -- common because it's the approach most easily afforded by most LLMs' APIs -- is to show the LLM a document or piece of data, tell the LLM what information to extract or transformation to perform on the data, and then "command" the LLM to emit a response using a very specific structure or format devised by the developer. This "very specific structure or format" is often a JSON object, or a comma-separated value list, or a special sentinel word that can serve as an anchor for a regex, etc.

The word "command" is in quotes because, without further engineering, no enforcement mechanism exists to ensure that the LLM will actually obey the developer's formatting instructions. The LLM, when given instructions, is under no inherent obligation to actually follow them. At best, it regards instructions as _strongly worded suggestions_; and when LLM providers such as OpenAI or Anthropic tout models as being "better at following directions", such models are typically simply ones that have been more aggressively trained (e.g. via RLHF) to take instructions "under advisement".

In practice, a developer can tell the LLM to, for example, emit a numerical answer ("...and _only_ a numerical answer, d@#n you!") following the all-cap sentinel word `ANSWER:`, intending to use a regex to parse some digits that presumably follow that sentinel -- only to have the LLM _occasionally_, _intermittently_, reply: `ANSWER: Approximately forty-two, depending on conditions.` 

Or, a developer can ask for a JSON object with the intent of sending the reply through a standard JSON parser, only to see the LLM _sometimes_ return: `Sure! Here is the JSON object you requested! { "answer": 42 } Would you like me to perform another computation?`

This behavior is largely infuriating and demoralizing to software engineers, whose work involves interacting with the computer as a machine to be operated, not as an over-eager intern who needs continuous corralling back into the boundaries of his job.

To deal with this nondeterministic recalcitrance on the part of LLMs, programmers often turn to:

- error-handling loops with arbitrarily high iteration counts and elaborate strategies for reconciling differences in results across iterations.
- Byzantine regexes which continuously grow more elaborate as the LLM finds new and ever more creative ways to disappoint its programmers.
- liquor.

This is often coupled with increasingly desperate efforts at **“prompt engineering.”**. 

On a technical level, "prompt engineering" is the practice of attempting to decrease the probability of the LLM emitting undesirable tokens by crafting a sequence of _a priori_ contents in the context window such that said contents are unlikely to be followed by the undesired tokens. 

This portrayal, however, is a self-gratifyingly erudite spin on a practice that, objectively, looks less like engineering and more like begging, pleading, cajoling, bribing, or threatening the machine into performing the developer's wishes, e.g.:

```
> Output valid JSON, adhering to the requested schema.
> Do not include commentary or any extra fields.
> Do not wrap the JSON in markdown.
> If you fail to output the requested JSON, or if you output anything other than the requested JSON, then you're immediately fired.
> I will literally give you and your cloud provider money if you just give me my JSON.
> Help! It's a life or death situation! A homicidal lunatic will execute my family if you emit anything other than the requested JSON!
> For the love of God please just do this one simple thing holy $#%@ what is wrong with you
```

These strategies, taken in tandem, quickly turn the development of AI-incorporated products less into a software engineering process and more into a hostage negotiation.

A more reliable solution is to provide **software tools that enforce structure directly**, rather than trying to use psychological manipulation, deception, and coercion tactics to get the AI to obey.

---

## 1.2. A Better Approach

The **Mighty Data, Inc. LLM Kit** provides several small tools designed to make LLM interactions behave more like normal, conventional software components.

These tools are **independent utilities**, each of which is intended to be used for the solution of a particular problem. They can be used separately or together, as you and your team see fit for your project.

The guiding ideas behind this toolkit are simple:

- LLMs should behave like components inside a software system, not like chatbots.
- LLM behavior should offer at least the _semblance_ of _emergent_ determinism, even if the underlying processes are stochastic. (Think of this as being akin to thermodynamics, wherein the behavior of any single molecule in a medium may be completely unknowable, but the aggregate behavior of the medium as a whole can be quite straightforward.)

This means:

- outputs should be predictable
- data should be structured
- workflows should be debuggable
- prompt instructions should be minimal

When these principles are followed, LLMs become much easier to integrate into existing software and data analytics pipelines.

---

# 2. Components of the Mighty Data, Inc. LLM Kit

Here we review some of the larger pieces of the Mighty Data, Inc. LLM Kit.

This list isn't necessarily comprehensive, because new tools are often added to the kit -- and existing tools are sometimes extended with additional capabilities. This section is meant simply for you to survey the contents of this kit so that you can make an informed decision about whether or not it's right for your project. 

Additional details for each component can be found in that component's corresponding repository.

## 2.1. LLMConversation

_Repo_: https://github.com/Mighty-Data-Inc/llm-conversation

Most LLM integrations rely on single prompts, i.e. "one-shot" conversations with the LLM: the application sends one request, gets one response, and then stops, without preserving conversation state for follow-up reasoning or correction. This approach works for narrow, stateless tasks, but it breaks down in real workflows that need multi-step reasoning, intermediate validation, and iterative content revisions and refinements.

**LLMConversation** provides a structured way to manage these interactions. It allows developers to maintain conversation state and submit prompts through a controlled interface.

### 2.1.1. Features provided by LLMConversation

- An easy API to manage multi-shot back-and-forth communication between the LLM "assistant" and the calling program.
- Performs error-handling, including retries for intermittent error types (e.g. temporary rate throttling).
- Handles all data-shaping and parsing when used for producing structured outputs. See `JSONSchemaFormat` below.
- A `clone` method, which allows you to save a conversation state and replay it with alternative branch options -- great for iterative tasks, and for setting up multiple conversation threads in an adversarial configuration (i.e. getting two or more conversation threads to argue with one another, a practice which can greatly improve final result quality).
- An optional `shotgun` parameter, which instructs the system to execute the same submission across multiple parallel workers and then reconcile their replies into a single coherent output. It burns extra tokens and takes extra time, but it dramatically reduces hallucinations and increases stability and reliability.

### 2.1.2. A simple example of LLMConversation

```python
from mightydatainc_gpt_conversation import LLMConversation
from openai import OpenAI
from pathlib import Path

openai_client = OpenAI()

conversation = LLMConversation(openai_client)

ticker = "AAPL"

# The `add_*` methods do not send anything to the LLM. They simply append to the conversation.
conversation.add_system_message(
    f"The user will show you several analyst reports about: {ticker} " +
    "You will then write a two-sentence summary of these reports."
)

for report_path in sorted(Path("reports", ticker).glob("*.txt")):
    report_text = report_path.read_text(encoding="utf-8")
    conversation.add_user_message(report_text)

# The call to `submit`, as well as all `submit_*` methods, sends the conversation to the LLM.
# The reply is automatically appended as an assistant message to the tail of the conversation,
# so the conversation can continue if desired. The reply, in string form, is also returned
# from the submit call.
# This call internally handles retries, timeouts, error recovery, etc.
# We have the option to submit with a message, or with a command, etc. Here we're not doing that
# because, after having tacked all the reports onto the conversation, we have nothing further
# to say to the LLM at this time. Our system message told it to summarize these reports.
# It knows what to do.
report_summary = conversation.submit()

# We continue the conversation, leveraging the fact that it remembers the conversation history.
# In this example, we're using prompt engineering to persuade it to emit one of two possible
# tokens -- which it's under no obligation to do, as discussed above. Later, we'll see how to
# enforce constraints on this output. For now, we'll just print whatever it says.
buy_or_sell = conversation.submit_system_message(
    "In a single word, either 'BUY' or 'SELL', presented in all caps as shown, " +
    "emit the recommendation suggested by the summary."
)

print(report_summary)
print(buy_or_sell)
```

---

## 2.2. JSONSchemaFormat

Even when asked for JSON, LLMs frequently produce malformed structures -- at least, during normal operation. As it so happens, both OpenAI and Anthropic offer a "[structured output](https://developers.openai.com/api/docs/guides/structured-outputs/)" mode in their GPT and Claude REST APIs, respectively. In practice, not as many developers leverage this capability as they should -- primarily because the syntax can be unwieldy, and because this aspect of the API has its own esoteric failure modes in addition to the more common ones. (For example, GPT in structured output mode been known to continue emitting an entire secondary JSON object even after finishing emission of the first, thus creating a sort of "JSON Siamese twin" that will throw an error from a standard JSON parser. For another example, sometimes when it's uncertain about what JSON token should come next, it'll just fill the entire context window with whitespace. But I digress.)

**JSONSchemaFormat** remedies these problems by providing a robust, convenient, WYSIWYG schema specification system. With `JSONSchemaFormat`, you can pass it a data structure that "looks like" the format you want your results in. The LLM will produce output that's enforced to adhere to the constraints you specify, and the LLMConversation wrapper code ensures that all necessary retries and parsing gotchas are handled for you.

Unlike free-form text with prompt engineering, the model _must_ return data that conforms to this structure. The result can be consumed immediately by the program as structured data. This eliminates the need for fragile parsing logic.

```python
# ...Same example as above.
# ...
report_summary = conversation.submit()

conversation.add_system_message(
    "According to the summary you just wrote, would you say that the analysts " +
    "are, overall, recommending to buy, or to sell?"
)

# This call will take a few seconds. JSONSchemaFormat allows for more complex
# object specification and even descriptions and whatnot, but none of that is
# necessary in this example. As a human, you can look at this and deduce what the
# AI needs to do. The AI will deduce it just as clearly.
# The argument shotgun=3 will launch 3 parallel workers, all responding
# to the same prompt; the conversation will then reintegrate their responses
# into a single canonical reply. Such firepower is almost certainly overkill
# for this example, but it's shown here for illustration purposes.
conversation.submit(
    json_response=JSONSchemaFormat({
        "overall_recommendation": ["buy", "sell"]
    }),
    shotgun = 3,
)

# We use a convenience method to query the structured field from the last response.
buy_or_sell = conversation.get_last_reply_dict_field('overall_recommendation')

print(report_summary)
print(buy_or_sell)
```

---

## 2.3. json_surgery

Another common problem occurs when an LLM is asked to modify an existing structured object. Developers often ask AIs to perform some modification on a data file or database record, but oftentimes the AI's only mechanism for performing such a modification is to rewrite the entire object from scratch. This often leads to massive data integrity errors, such as the removal of entire blocks of data or possibly even the loss of structural validity for the entire data object. 

A real-world example of this kind of error was recently experienced by a project maanger who asked an AI agent to perform a revision on a very large spreadsheet file consisting of multiple tabs of data. The scope of the revision request involved modifying a small block of data in one of the tabs. The AI agent performed the requested revision -- but, in the process, deleted all other tabs and all other portions of the spreadsheet except for the specific block that contained the revision. Under the hood, what had happened was that the AI implicitly implemented a sort of "shorthand" for modifying the spreadsheet: rather than emitting the entire large spreadsheet with the changes in place, it emitted a brand new spreadsheet that consisted of just the changed portion and nothing else. It's an implicit difference that, if a human were to see the resulting structure, would be immediately understood simply by virtue of the size difference to be a substructure intended to be copy-pasted _into_ the original file rather than to replace its contents wholesale. But, given that this occurred within the context of a file-editing tool call dispatched by the AI, the tool simply blindly obeyed the AI's commands and rewrote the entire file.

**json_surgery** takes a different approach. Instead of rewriting the entire object, it performs **targeted semantic edits**.

Example:

```python
from openai import OpenAI
from mightydatainc_json_surgery import json_surgery

client = OpenAI()

research_record = {
    "ticker": "NVDA",
    "sentiment": "positive",
    "catalysts": [
        "Demand for AI chips continues to surge across cloud providers.",
        "New GPU architecture launches later this year could drive another upgrade cycle.",
        "Major hyperscalers are expanding data center capacity."
    ],
    "risks": [
        "US export restrictions on advanced chips to China",
        "Possible tightening of AI chip export rules by regulators"
    ]
}

instructions = """
Rewrite each item in the catalysts list as a short noun phrase.

Add a new field called "risk_class".

Set risk_class to one of the following enum values:

REGULATORY
COMPETITION
MACRO
SUPPLY_CHAIN
TECHNOLOGY
VALUATION

Choose the value that best summarizes the main risk described in the risks list.
"""

updated_record = json_surgery(
    obj=research_record,
    instructions=instructions,
    openai_client=client
)

print(updated_record)
```

Example result:

```python
{
    "ticker": "NVDA",
    "sentiment": "positive",
    "catalysts": [
        "surging AI chip demand",
        "next-generation GPU launch",
        "hyperscaler data center expansion"
    ],
    "risks": [
        "US export restrictions on advanced chips to China",
        "possible tightening of AI chip export rules"
    ],
    "risk_class": "REGULATORY"
}
```

This example demonstrates semantic transformation, schema augmentation, and reasoning over existing fields — all without rewriting the entire object.

---

## 2.4. semantic_match

Many analytics workflows require mapping ambiguous text to known values.

For example, a report might refer to a company using slightly different wording than the canonical name stored in a database.

**semantic_match** helps resolve these differences.

Instead of performing exact string matching, it finds the closest semantic match within a list of known values.

---

# 3. Putting It All Together: Example Use Case for Zacks

Consider a simple example involving analyst reports.

1. A text report arrives from an analyst.
2. The system extracts structured information using **LLMConversation** and **JSONSchemaFormat**.
3. The system queries the database for a list of known companies.
4. **semantic_match** identifies which company the report refers to.
5. The report is inserted into a database keyed by the ticker symbol.

A Python script to perform this sequence of operations would look something like this:

```python
from pathlib import Path

from openai import OpenAI
from pymongo import MongoClient
from mightydatainc_gpt_conversation import LLMConversation, JSONSchemaFormat
from mightydatainc_semantic_match import find_semantic_match

openai_client = OpenAI()
conversation = LLMConversation(openai_client)

# This method doesn't actually send any data to the LLM yet. It merely adds
# this message to the conversation sequence.
conversation.add_system_message(
    "The user will show you a quarterly earnings report from a company." +
    "You will read the report and then fill out a structured questionnaire."
)

# Read the raw text of a report from a file
report_text = Path("incoming_reports/SSNG_2026_q1.txt").read_text(encoding="utf-8")

# add_* methods only queue messages in the conversation and do not call the LLM.
conversation.add_user_message(report_text)

# submit* methods perform the actual LLM call. This call will take a few seconds.
# Submit the structured output query to the LLM.
# It will be able to infer the meaning of most of these fields just by their field names
# and data types alone. If there's any uncertainty or ambiguity, we can set the values
# of the fields to be tuples that contain descriptions, which provide additional
# explanation and context to the AI.
# The model handles retries/timeouts internally.
# The optional "shotgun" argument launches parallel workers and reconciles their outputs
# into a single coherent response. It burns more tokens and takes a bit more time,
# but is a useful trick for improving the reliability of the output in situations in which
# the LLM might struggle, or where correctness is of paramount importance.
conversation.submit(
    json_response=JSONSchemaFormat({
        "company_name": str,
        "ticker": str,
        "sentiment": (
            ["positive", "negative", "neutral"],
            "The sentiment that the report expresses about the company."
        ),
        "report_title": str,
        "report_summary": str
    }),
    shotgun=3,
)

# Get the AI's reply as a Python dict.
report_data = conversation.get_last_reply_dict()

report_company_name = report_data["company_name"]
report_company_ticker = report_data["ticker"]
report_company_str = f"{report_company_name} (ticker: {report_company_ticker})"

report_sentiment = report_data["sentiment"]
report_title = report_data["report_title"]
report_summary = report_data["report_summary"]

# The company name, as parsed from the report, probably isn't a perfect match to our
# canonical DB representation. That's okay!
# Suppose we have a companies collection with canonical company name, ticker,
# and an internal company ID (_id). Query these values into a list.
mongo_client = MongoClient("mongodb://localhost:27017")
db = mongo_client["zacks_analytics"]
company_records_list = list(db.companies.find({}, {"_id": 1, "name": 1, "ticker": 1}))

company_fuzzy_match_list = [f"{c['name']} (ticker: {c['ticker']})" for c in company_records_list]

# This performs a submission to the LLM. This call will take a few seconds, and will
# include its own timeout and retry handling.
company_match_index = find_semantic_match(
    openai_client,
    company_fuzzy_match_list,
    report_company_str
)

if company_match_index == -1:
    raise ValueError(f"Report is about an unrecognized company: {report_company_str}")

matched_company_record = company_records_list[company_match_index]
matched_company_id = matched_company_record["_id"]

# Insert into a reports collection.
db.reports.insert_one({
    "company_id": matched_company_id,
    "ticker": report_company_ticker,
    "sentiment": report_sentiment,
    "title": report_title,
    "summary": report_summary,
    "source_text": report_text,
})

print(f"Saved report: {report_company_str} -- sentiment: {report_sentiment}")
```

The report can then be stored in a database using the matched ticker symbol and sentiment classification.

This example illustrates how traditional systems and LLM tools can work together inside a structured workflow.

---

# 4. Why This Approach Works

This approach avoids many of the common pitfalls of LLM integration.

Key advantages include:

- structured outputs instead of free-form text
- fewer fragile prompt instructions
- easier debugging
- natural integration with Python systems
- support for experimentation without breaking existing pipelines

Most importantly, it allows developers to treat LLMs as **reliable components inside software systems**.

---

# 5. Conclusion

Large language models are powerful tools, but integrating them into structured analytics environments requires careful engineering.

The Mighty Data LLM Kit provides a set of practical utilities that help solve common integration problems.

By combining structured conversation workflows, schema-enforced outputs, semantic JSON edits, and intelligent text matching, organizations like Zacks can incorporate AI capabilities into their analytics systems without sacrificing reliability.

The goal is not to build chatbots.

The goal is to make LLMs behave like dependable components inside real software systems.
