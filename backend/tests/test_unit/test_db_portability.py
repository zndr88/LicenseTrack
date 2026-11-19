import pytest
from sqlalchemy import select

from app.models.license import License, LicenseMetric, LicenseType
from app.services.db_portability import greatest, json_list_is_empty


def _license(**overrides):
    values = dict(
        publisher_name="P",
        software_description="S",
        license_type=LicenseType.subscription,
        license_metric=LicenseMetric.per_user,
        quantity=1,
    )
    values.update(overrides)
    return License(**values)


@pytest.mark.parametrize("stored, expected", [(None, True), ([], True), ([7], False)])
async def test_json_list_is_empty(db_session, stored, expected):
    db_session.add(_license(coterm_from_ids=stored))
    await db_session.commit()
    found = (await db_session.execute(select(License.id).where(json_list_is_empty(License.coterm_from_ids)))).all()
    assert bool(found) is expected


async def test_greatest_picks_the_largest_value(db_session):
    assert await db_session.scalar(select(greatest(3, 9, 5))) == 9
    assert await db_session.scalar(select(greatest(9, 3, 5))) == 9
    assert await db_session.scalar(select(greatest(3, 5, 9))) == 9
