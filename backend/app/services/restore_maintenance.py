"""Application-level coordination for database replacement maintenance."""

from __future__ import annotations

import asyncio


class RestoreMaintenance:
    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._active_requests = 0
        self._maintenance = False
        self._restore_in_progress = False
        self._restore_owner: object | None = None

    @property
    def maintenance(self) -> bool:
        return self._maintenance

    async def enter_request(self, *, allow_during_maintenance: bool = False) -> bool:
        async with self._condition:
            if self._maintenance and not allow_during_maintenance:
                return False
            self._active_requests += 1
            return True

    async def leave_request(self) -> None:
        async with self._condition:
            self._active_requests = max(0, self._active_requests - 1)
            self._condition.notify_all()

    async def begin_restore(self) -> object:
        async with self._condition:
            if self._restore_in_progress:
                raise RuntimeError("A database restore is already in progress")
            owner = object()
            self._restore_in_progress = True
            self._restore_owner = owner
            self._maintenance = True
            self._condition.notify_all()
            try:
                while self._active_requests:
                    await self._condition.wait()
            except BaseException:
                self._maintenance = False
                self._restore_in_progress = False
                self._restore_owner = None
                self._condition.notify_all()
                raise
            return owner

    async def end_restore(self, owner: object) -> None:
        async with self._condition:
            if owner is not self._restore_owner:
                return
            self._maintenance = False
            self._restore_in_progress = False
            self._restore_owner = None
            self._condition.notify_all()


restore_maintenance = RestoreMaintenance()
