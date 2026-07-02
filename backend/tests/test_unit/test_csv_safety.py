from app.services.csv_safety import escape_csv_formula, safe_csv_row


def test_escape_csv_formula_prefixes_spreadsheet_formulas():
    assert escape_csv_formula("=HYPERLINK(\"http://example.test\")") == "'=HYPERLINK(\"http://example.test\")"
    assert escape_csv_formula("+SUM(1,2)") == "'+SUM(1,2)"
    assert escape_csv_formula("-10+20") == "'-10+20"
    assert escape_csv_formula("@cmd") == "'@cmd"
    assert escape_csv_formula("\t=1+1") == "'\t=1+1"
    assert escape_csv_formula("\r=1+1") == "'\r=1+1"
    assert escape_csv_formula("  =1+1") == "'  =1+1"


def test_escape_csv_formula_leaves_safe_values_and_non_strings_unchanged():
    assert escape_csv_formula("Northwind") == "Northwind"
    assert escape_csv_formula("2026-01-01") == "2026-01-01"
    assert escape_csv_formula(42) == 42


def test_safe_csv_row_applies_formula_escaping_to_each_cell():
    assert safe_csv_row(["Vendor", "=1+1", 7]) == ["Vendor", "'=1+1", 7]
