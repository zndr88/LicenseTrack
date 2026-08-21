# backend/app/services/import_/maintenance_parenting.py
from __future__ import annotations

import re

from app.services.csv_importer import ParsedRow
from app.services.import_.duplicate_detection import _norm_text


def _strip_maintenance_suffix(value: str) -> str:
    text = _norm_text(value)
    text = re.sub(r"\s*[-\u2013\u2014]\s*maintenance.*$", "", text)
    text = re.sub(r"\s+maintenance$", "", text)
    return text.strip()


def _contract_parent_key(value: str) -> str:
    text = _norm_text(value)
    return re.sub(r"[-_\s]*m(?:aintenance)?$", "", text).strip()


def _is_parent_candidate(row: ParsedRow) -> bool:
    return row.license_type in {"perpetual", "oem", "freeware"} and row.import_status != "error"


def _parent_match_score(maintenance: ParsedRow, parent: ParsedRow) -> int:
    if _norm_text(maintenance.publisher_name) != _norm_text(parent.publisher_name):
        return 0

    score = 1
    m_desc = _strip_maintenance_suffix(maintenance.software_description)
    p_desc = _strip_maintenance_suffix(parent.software_description)
    if m_desc and m_desc == p_desc:
        score += 3
    elif m_desc and p_desc and (m_desc.startswith(p_desc) or p_desc.startswith(m_desc)):
        score += 2

    if maintenance.po_number and parent.po_number and _norm_text(maintenance.po_number) == _norm_text(parent.po_number):
        score += 3

    m_contract = _contract_parent_key(maintenance.contract_number)
    p_contract = _contract_parent_key(parent.contract_number)
    if m_contract and p_contract and m_contract == p_contract:
        score += 3

    return score


def _set_parent_error(row: ParsedRow, reason: str) -> None:
    row.import_status = "error"
    row.lifecycle_status = None
    row.is_completeness_exempt = False
    if not any("parent_license_ref" in error for error in row.validation_errors):
        row.validation_errors.append(reason)


def infer_batch_maintenance_parents(rows: list[ParsedRow]) -> None:
    """Infer parent links for maintenance rows that lack an explicit parent_license_ref."""
    candidates = [row for row in rows if _is_parent_candidate(row)]
    for row in rows:
        if row.license_type == "maintenance" and (
            row.selected_parent_license_id is not None
            or row.maintenance_parent_action == "import_legacy_unlinked"
        ):
            continue
        if row.license_type != "maintenance" or row.parent_license_ref:
            continue

        scored = [
            (candidate, _parent_match_score(row, candidate))
            for candidate in candidates
            if candidate.row_number != row.row_number
        ]
        matches = [(c, s) for c, s in scored if s >= 5]
        if not matches:
            _set_parent_error(
                row,
                "Maintenance rows require a 'parent_license_ref' column or a matching "
                "perpetual/oem/freeware parent row in the same import.",
            )
            continue

        matches.sort(key=lambda item: (-item[1], item[0].row_number))
        best_score = matches[0][1]
        best_matches = [c for c, s in matches if s == best_score]
        if len(best_matches) > 1:
            _set_parent_error(
                row,
                "Maintenance parent is ambiguous; add a 'parent_license_ref' column "
                "to choose the parent perpetual/oem/freeware license.",
            )
            continue

        parent = best_matches[0]
        if parent.row_number > row.row_number:
            _set_parent_error(
                row,
                f"Inferred maintenance parent row {parent.row_number} must appear before "
                f"maintenance row {row.row_number} in the import file.",
            )
            continue
        row.parent_import_row_number = parent.row_number
        if parent.license_ref:
            row.parent_license_ref = parent.license_ref
        row.warnings.append(f"Linked to parent row {parent.row_number} for maintenance import.")
