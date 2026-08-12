from datetime import date, datetime
from typing import Optional

DATE_FORMAT_VARIANTS = {
    "DD/MM/YYYY": ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"),
    "MM/DD/YYYY": ("%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y"),
    "YYYY-MM-DD": ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"),
}


def parse_import_date(raw: str, date_format: str) -> tuple[Optional[date], bool, str, str]:
    """Parse a CSV import date using ISO and the declared import date format.

    Returns:
        (parsed_date, is_perpetual, error_message, warning_message)
    """
    raw = raw.strip().strip("'\"")
    if not raw:
        return None, False, "", ""

    if raw.lower() == "perpetual":
        return None, True, "", ""

    formats = ("%Y-%m-%d", *DATE_FORMAT_VARIANTS.get(date_format, ("%d/%m/%Y",)))
    for fmt in dict.fromkeys(formats):
        try:
            parsed = datetime.strptime(raw, fmt).date()
            if parsed.year >= 2099:
                return None, True, "", f"Date {raw!r} has year >= 2099 - treated as perpetual"
            return parsed, False, "", ""
        except ValueError:
            continue

    return (
        None,
        False,
        f"Unrecognised date format: {raw!r}; expected ISO YYYY-MM-DD or declared format {date_format}",
        "",
    )
