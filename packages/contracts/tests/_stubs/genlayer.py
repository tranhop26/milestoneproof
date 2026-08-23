from __future__ import annotations

from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable

import cloudpickle


class UserError(Exception):
    pass


class ProtocolError(Exception):
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


_storage_allocation_allowed = False


class DynArray(list):
    def __init__(self, *args: Any) -> None:
        if type(self) is DynArray and not _storage_allocation_allowed:
            raise TypeError("DynArray must be allocated with storage.inmem_allocate")
        super().__init__(*args)


class TreeMap(dict):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        if not _storage_allocation_allowed:
            raise TypeError("TreeMap must be allocated with storage.inmem_allocate")
        super().__init__(*args, **kwargs)


def allow_storage(cls: type[Any]) -> type[Any]:
    return cls


def event(cls: type[Any]) -> type[Any]:
    cls.__genlayer_event__ = True
    return dataclass(cls)


class Event:
    name = "Event"

    def __init_subclass__(cls) -> None:
        declared_init = cls.__dict__["__init__"]
        positional_only_count = declared_init.__code__.co_posonlyargcount - 1
        indexed_names = declared_init.__code__.co_varnames[
            1 : positional_only_count + 1
        ]
        cls.name = cls.__name__

        def initialize(self, *args, **kwargs):
            if len(args) != len(indexed_names):
                raise TypeError("indexed event fields mismatch")
            self._blob = dict(kwargs)
            for name, value in zip(indexed_names, args):
                self._blob[name] = value

        cls.__init__ = initialize

    def emit(self) -> None:
        _runtime().events.append((type(self).name, dict(self._blob)))


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
    chain_id: int = 61999
    contract_address: Address = Address("0xc000000000000000000000000000000000000001")


@dataclass
class _MessageRaw:
    datetime: int = 0


@dataclass
class _Runtime:
    message: _Message
    message_raw: _MessageRaw
    web_responses: dict[str, str]
    prompt_result: Any
    validator_prompt_result: Any
    prompt_handler: Callable[..., Any] | None
    nondet_phase: str
    serialize_nondet_callables: bool
    nondet_serializations: list[bytes]
    protocol_exception_phase: str | None
    events: list[tuple[str, dict[str, Any]]]


_runtime_var: ContextVar[_Runtime] = ContextVar(
    "genlayer_runtime",
    default=_Runtime(
        message=_Message(),
        message_raw=_MessageRaw(),
        web_responses={},
        prompt_result=None,
        validator_prompt_result=None,
        prompt_handler=None,
        nondet_phase="leader",
        serialize_nondet_callables=False,
        nondet_serializations=[],
        protocol_exception_phase=None,
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


def set_chain_id(chain_id: int) -> None:
    _runtime().message.chain_id = int(chain_id)


def set_contract_address(contract_address: Address | str) -> None:
    _runtime().message.contract_address = Address(str(contract_address))


def set_web_response(url: str, content: str) -> None:
    _runtime().web_responses[url] = content


def set_prompt_result(result: Any) -> None:
    runtime = _runtime()
    runtime.prompt_result = result
    runtime.validator_prompt_result = result
    runtime.prompt_handler = None


def set_validator_prompt_result(result: Any) -> None:
    _runtime().validator_prompt_result = result


def set_prompt_handler(handler: Callable[..., Any]) -> None:
    runtime = _runtime()
    runtime.prompt_handler = handler


def require_nondet_serialization(enabled: bool = True) -> None:
    runtime = _runtime()
    runtime.serialize_nondet_callables = enabled
    runtime.nondet_serializations = []


def get_nondet_serializations() -> list[bytes]:
    return list(_runtime().nondet_serializations)


def set_protocol_exception(phase: str | None) -> None:
    if phase not in (None, "leader", "validator", "consensus"):
        raise ValueError("invalid protocol exception phase")
    _runtime().protocol_exception_phase = phase


def clear_runtime() -> None:
    _runtime_var.set(
        _Runtime(
            message=_Message(),
            message_raw=_MessageRaw(),
            web_responses={},
            prompt_result=None,
            validator_prompt_result=None,
            prompt_handler=None,
            nondet_phase="leader",
            serialize_nondet_callables=False,
            nondet_serializations=[],
            protocol_exception_phase=None,
            events=[],
        )
    )


class _StorageNamespace:
    @staticmethod
    def inmem_allocate(storage_type: Any, *args: Any, **kwargs: Any) -> Any:
        global _storage_allocation_allowed
        _storage_allocation_allowed = True
        try:
            return storage_type(*args, **kwargs)
        finally:
            _storage_allocation_allowed = False

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
        if runtime.nondet_phase == "validator":
            return runtime.validator_prompt_result
        return runtime.prompt_result


@dataclass
class Return:
    calldata: Any


class _VmNamespace:
    Return = Return
    UserError = UserError

    @staticmethod
    def run_nondet_unsafe(
        leader_fn: Callable[[], Any], validator_fn: Callable[[Return], bool]
    ) -> Any:
        runtime = _runtime()
        try:
            if runtime.serialize_nondet_callables:
                try:
                    runtime.nondet_serializations = [
                        cloudpickle.dumps(leader_fn),
                        cloudpickle.dumps(validator_fn),
                    ]
                except Exception as error:
                    raise ProtocolError(
                        "nondeterministic callable is not serializable"
                    ) from error
            runtime.nondet_phase = "leader"
            if runtime.protocol_exception_phase == "leader":
                raise ProtocolError("leader protocol exception")
            leader_result = leader_fn()
            runtime.nondet_phase = "validator"
            if runtime.protocol_exception_phase == "validator":
                raise ProtocolError("validator protocol exception")
            try:
                accepted = validator_fn(Return(deepcopy(leader_result)))
            except Exception as error:
                raise ProtocolError("validator execution disagreed") from error
            if accepted is not True:
                raise ProtocolError("semantic consensus was not reached")
            if runtime.protocol_exception_phase == "consensus":
                raise ProtocolError("consensus protocol exception")
            return leader_result
        finally:
            runtime.nondet_phase = "leader"


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
    def __getstate__(self) -> Any:
        raise TypeError("contract storage root cannot cross nondeterministic boundary")


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
vm = _VmNamespace()
message = _RuntimeAccessor("message")
message_raw = _RuntimeAccessor("message_raw")


def __getattr__(name: str) -> Any:
    if name == "message":
        return _runtime().message
    if name == "message_raw":
        return _runtime().message_raw
    raise AttributeError(name)
