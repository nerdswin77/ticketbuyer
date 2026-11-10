"""In-process pub/sub that fans server events out to WebSocket clients.

Must be called from the event-loop thread (all routes are `async def`).
"""

import asyncio
import logging
from collections import deque
from typing import Any

from .models import now_ms

log = logging.getLogger("kickoff")


class EventBus:
    def __init__(self, history: int = 300) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._logs: deque[dict[str, Any]] = deque(maxlen=history)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=2000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    def publish(self, type_: str, data: Any) -> None:
        msg = {"type": type_, "data": data}
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:  # slow client: drop rather than block the engine
                pass

    def log(self, level: str, message: str) -> None:
        entry = {"ts": now_ms(), "level": level, "message": message}
        self._logs.append(entry)
        getattr(log, "error" if level == "error" else "warning" if level == "warn" else "info")(message)
        self.publish("log", entry)

    def recent_logs(self) -> list[dict[str, Any]]:
        return list(self._logs)


bus = EventBus()
