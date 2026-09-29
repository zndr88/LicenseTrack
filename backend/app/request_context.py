"""The current request's "METHOD /path", for log lines raised deep in validation."""

from contextvars import ContextVar

current_request: ContextVar[str] = ContextVar("current_request", default="(no request)")
