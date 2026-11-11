"""Upgrade the database schema, then exit.

Run from the backend folder, with the same environment as the app:

    python -m app.upgrade

Exit code 0 means the schema is current; 1 means the upgrade failed and the
log says why. Use this when RUN_MIGRATIONS_ON_STARTUP is off, for example as a
one-off job before starting several copies of the app.
"""

import logging
import sys

from app.config import settings
from app.services.schema_upgrade import upgrade_schema

logger = logging.getLogger("app.upgrade")


def main() -> int:
    logging.basicConfig(level=settings.LOG_LEVEL.upper(), format="%(levelname)s %(name)s: %(message)s")
    try:
        upgrade_schema()
    except Exception:
        logger.exception("Database upgrade failed")
        return 1
    logger.info("Database schema is up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
