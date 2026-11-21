/**
 * Shared CSV assembly for exports built in the browser.
 *
 * Text cells that a spreadsheet would read as a formula (leading =, +, - or @,
 * also after whitespace) get an apostrophe in front, the same protection the
 * server-side exports apply in backend/app/services/csv_safety.py. Numbers are
 * written as they are, so a negative number stays a number.
 */
const FORMULA_START = /^\s*[=+\-@]/;

export function escapeCsvCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const raw = String(value ?? "");
  const text = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r"))
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/** Build CSV text with a UTF-8 byte order mark so Excel reads accents correctly. */
export function buildCsvContent(headers, rows) {
  const lines = [headers, ...rows].map((cells) => cells.map(escapeCsvCell).join(","));
  return `\ufeff${lines.join("\r\n")}`;
}

export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
