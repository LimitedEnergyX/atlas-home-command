"""Portable, pinned operating charter and explicit local inference budgets."""
import hashlib
import json
from pathlib import Path

CHARTER_PATH = Path(__file__).resolve().parents[2] / 'AI_RULES.md'
CHARTER_SHA256 = '7d2b000b6ad0a338b5c696a746c8ed91b1986406be3f0dd9709860703dc4fcb5'
CONTEXT_TOKENS = 16384
OUTPUT_TOKENS = 700
# Reserve template/control tokens in addition to counting each UTF-8 byte as a
# conservative token upper bound. This is deliberately not a chars/4 estimate.
TEMPLATE_RESERVE = 512
MESSAGE_RESERVE = 32


def load_charter():
    """Read each request, so a missing, shortened, or changed policy fails closed.

    Do not run this at application startup: manual controls must remain usable
    even if the conversational policy asset needs repair.
    """
    try:
        raw = CHARTER_PATH.read_bytes()
        if hashlib.sha256(raw).hexdigest() != CHARTER_SHA256:
            raise ValueError('policy fingerprint differs')
        return raw.decode('utf-8')
    except (OSError, UnicodeError, ValueError) as exc:
        raise ValueError('The full AI operating charter is missing or invalid. Chat is paused; manual controls remain available.') from exc


def with_charter(messages):
    """Ensure exactly one verbatim charter in the leading system message."""
    charter = load_charter()
    result = [dict(message) for message in messages]
    if not result or result[0].get('role') != 'system':
        result.insert(0, {'role': 'system', 'content': charter})
    else:
        content = result[0].get('content', '')
        if not isinstance(content, str):
            raise ValueError('Invalid system instructions')
        if charter in content:
            if not content.startswith(charter) or content.count(charter) != 1:
                raise ValueError('The complete AI operating charter must appear exactly once at the start of system instructions.')
        else:
            result[0]['content'] = charter + '\n\n' + content
    if any(message.get('role') == 'system' for message in result[1:]):
        raise ValueError('Only one server-owned system message is permitted')
    return result


def context_cost(messages, schema):
    """Conservative content byte bound, output reserve, and template overhead.

    The byte bound avoids guessing a tokenizer's English compression ratio.
    Record actual runtime token counts in acceptance tests before increasing
    throughput. Huge messages fail rather than relying on Ollama truncation.
    """
    return (sum(len(message['content'].encode('utf-8')) + MESSAGE_RESERVE for message in messages)
            + len(json.dumps(schema, ensure_ascii=True).encode('utf-8'))
            + OUTPUT_TOKENS + TEMPLATE_RESERVE)


def check_context(messages, schema):
    if context_cost(messages, schema) > CONTEXT_TOKENS:
        raise ValueError('This request is too large for the local AI context with the full operating charter. Use a shorter message or a more specific product name. No stock was changed.')


def fit_history(messages, schema):
    """Drop only oldest history, never charter, latest message, or stock facts.

    Returns omitted message count so the UI can disclose context reduction.
    Kept content is copied without summarizing or shortening any message.
    """
    result = [dict(message) for message in messages]
    dropped = 0
    while context_cost(result, schema) > CONTEXT_TOKENS and len(result) > 2:
        count = 2 if len(result) > 3 and result[1]['role'] == 'user' and result[2]['role'] == 'assistant' else 1
        del result[1:1 + count]
        dropped += count
    check_context(result, schema)
    return result, dropped
