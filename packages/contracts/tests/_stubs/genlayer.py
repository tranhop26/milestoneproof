from __future__ import annotations

from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable


class UserError(Exception):
    pass


class Address(str):
    def __new__(cls, value: str) -> "Address":
        normalized = value.lower()
        if not normalized.startswith("0x") or len(normalized) != 42:
            raise ValueError(f"invalid address: {value}")
        return str.__new__(cls, normalized)


class _UInt(int):
    bits = 256

    def __new__(cls, value: int | str = 0) -> "_UInt":
        integer = int(value)
        if integer < 0:
            raise ValueError("unsigned integers cannot be negative")
        max_value = (1 << cls.bits) - 1
        if integer > max_value:
            raise ValueError(f"value does not fit in u{cls.bits}")
        return int.__new__(cls, integer)


class u8(_UInt):
    bits = 8


class u16(_UInt):
    bits = 16


class u32(_UInt):
    bits = 32


class u64(_UInt):
    bits = 64


class u128(_UInt):
    bits = 128


class u256(_UInt):
    bits = 256


class DynArray(list):
    pass


class TreeMap(dict):
    pass


def allow_storage(cls: type[Any]) -> type[Any]:
    return cls


def event(cls: type[Any]) -> type[Any]:
    cls.__genlayer_event__ = True
    return dataclass(cls)


class _PublicNamespace:
    def __call__(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        fn.__genlayer_public__ = True
        return fn

    def view(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        fn.__genlayer_view__ = True
        return fn

    def write(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        fn.__genlayer_write__ = True
        return fn


@dataclass
class _Message:
    sender_address: Address = Address("0x0000000000000000000000000000000000000000")


@dataclass
class _MessageRaw:
    datetime: int = 0


@dataclass
class _Runtime:
    message: _Message
    message_raw: _MessageRaw
    web_responses: dict[str, str]
    prompt_result: Any
    prompt_handler: Callable[..., Any] | None
    events: list[tuple[str, dict[str, Any]]]


_runtime_var: ContextVar[_Runtime] = ContextVar(
    "genlayer_runtime",
    default=_Runtime(
        message=_Message(),
        message_raw=_MessageRaw(),
        web_responses={},
        prompt_result=None,
        prompt_handler=None,
        events=[],
    ),
)


def _runtime() -> _Runtime:
    return _runtime_var.get()


def set_sender(sender: Address | str) -> None:
    runtime = _runtime()
    runtime.message.sender_address = Address(str(sender))


def set_now(timestamp: int) -> None:
    runtime = _runtime()
    runtime.message_raw.datetime = int(timestamp)


def set_web_response(url: str, content: str) -> None:
    _runtime().web_responses[url] = content


def set_prompt_result(result: Any) -> None:
    runtime = _runtime()
    runtime.prompt_result = result
    runtime.prompt_handler = None


def set_prompt_handler(handler: Callable[..., Any]) -> None:
    runtime = _runtime()
    runtime.prompt_handler = handler


def clear_runtime() -> None:
    _runtime_var.set(
        _Runtime(
            message=_Message(),
            message_raw=_MessageRaw(),
            web_responses={},
            prompt_result=None,
            prompt_handler=None,
            events=[],
        )
    )


def emit(name: str, **payload: Any) -> None:
    _runtime().events.append((name, payload))


class _StorageNamespace:
    @staticmethod
    def copy_to_memory(value: Any) -> Any:
        return deepcopy(value)


class _WebNamespace:
    @staticmethod
    def render(url: str, mode: str = "text") -> str:
        return _runtime().web_responses.get(url, "")


class _NondetNamespace:
    web = _WebNamespace()

    @staticmethod
    def exec_prompt(*args: Any, **kwargs: Any) -> Any:
        runtime = _runtime()
        if runtime.prompt_handler is not None:
            return runtime.prompt_handler(*args, **kwargs)
        return runtime.prompt_result


class _SemanticNamespace:
    @staticmethod
    def same_output(left: Any, right: Any) -> bool:
        return left == right

    @staticmethod
    def normalize(value: Any) -> Any:
        return value

    @staticmethod
    def equivalent(fn: Callable[..., Any]) -> Callable[..., Any]:
        fn.__genlayer_semantic_equivalence__ = True
        return fn


class Contract:
    pass


class _RuntimeAccessor:
    def __init__(self, field_name: str) -> None:
        object.__setattr__(self, "_field_name", field_name)

    def __getattr__(self, name: str) -> Any:
        target = getattr(_runtime(), object.__getattribute__(self, "_field_name"))
        return getattr(target, name)

    def __setattr__(self, name: str, value: Any) -> None:
        target = getattr(_runtime(), object.__getattribute__(self, "_field_name"))
        setattr(target, name, value)


public = _PublicNamespace()
storage = _StorageNamespace()
nondet = _NondetNamespace()
semantic = _SemanticNamespace()
message = _RuntimeAccessor("message")
message_raw = _RuntimeAccessor("message_raw")


def __getattr__(name: str) -> Any:
    if name == "message":
        return _runtime().message
    if name == "message_raw":
        return _runtime().message_raw
    raise AttributeError(name)
