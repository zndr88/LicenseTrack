import asyncio

import pytest

from app.services.restore_maintenance import RestoreMaintenance


async def test_restore_waits_for_existing_requests_and_rejects_new_requests():
    maintenance = RestoreMaintenance()
    assert await maintenance.enter_request() is True

    restore_task = asyncio.create_task(maintenance.begin_restore())
    await asyncio.sleep(0)

    assert maintenance.maintenance is True
    assert await maintenance.enter_request() is False
    assert not restore_task.done()

    await maintenance.leave_request()
    owner = await restore_task
    await maintenance.end_restore(owner)

    assert maintenance.maintenance is False
    assert await maintenance.enter_request() is True
    await maintenance.leave_request()


async def test_only_restore_owner_can_end_maintenance():
    maintenance = RestoreMaintenance()
    owner = await maintenance.begin_restore()

    await maintenance.end_restore(object())
    assert maintenance.maintenance is True

    await maintenance.end_restore(owner)
    assert maintenance.maintenance is False


async def test_cancelled_restore_wait_releases_maintenance():
    maintenance = RestoreMaintenance()
    assert await maintenance.enter_request() is True
    restore_task = asyncio.create_task(maintenance.begin_restore())
    await asyncio.sleep(0)

    restore_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await restore_task

    assert maintenance.maintenance is False
    await maintenance.leave_request()
