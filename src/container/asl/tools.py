"""The Python binding of the surface (conditions py-cpython and py-pyodide).

Every function of the task is an attribute of this module:
tools.read_file(path="a.txt"), tools.sqlite(sql="SELECT 1").
A refused or failed call raises SurfaceError.

The transport is set by the runner: a Unix socket to the broker (CPython in
the script container) or a JavaScript function (Pyodide in Deno).
"""

import json


class SurfaceError(Exception):
    """A call that the surface refused, or that failed."""

    def __init__(self, message, refused=False):
        super().__init__(message)
        self.refused = refused


_transport = None


def _set_transport(send):
    """send(request_json: str) -> reply_json: str"""
    global _transport
    _transport = send


def _call(fn, args):
    if _transport is None:
        raise SurfaceError("the surface is not connected")
    reply = json.loads(_transport(json.dumps({"fn": fn, "args": args})))
    if not reply.get("ok"):
        refused = bool(reply.get("refused"))
        raise SurfaceError(("refused: " if refused else "error: ") + str(reply.get("error")), refused)
    return reply.get("value")


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)

    def function(*positional, **kwargs):
        if positional:
            names = _PARAMS.get(name)
            if names is None or len(positional) > len(names):
                raise TypeError(f"{name}() takes keyword arguments; see the list of functions")
            # positional may be shorter than names: the rest are keyword or absent.
            kwargs = {**dict(zip(names, positional, strict=False)), **kwargs}
        return _call(name, {k: v for k, v in kwargs.items() if v is not None})

    function.__name__ = name
    return function


# Parameter names in order, so that positional calls also work. Set by the runner.
_PARAMS = {}
