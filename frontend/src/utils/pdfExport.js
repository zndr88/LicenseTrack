import { formatDate } from "./formatting.js";
import { formatCost } from "./helpers.js";

// A4 landscape in points (jsPDF default unit)
const A4_W = 841.89;
const A4_H = 595.28;
const MARGIN = 30;
const HEADER_H = 30; // pt reserved above the image for header text

function todayStr(settings) {
  // Get today's date in the user's timezone as YYYY-MM-DD, then format per their preference.
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings?.timeZone || "UTC",
  }).format(new Date());
  return formatDate(isoDate, settings);
}

async function loadPdfDependencies() {
  const [{ jsPDF }, html2canvasModule] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  return {
    jsPDF,
    html2canvas: html2canvasModule.default,
  };
}

async function captureElement(el, html2canvas) {
  // Resolve --bg-1 CSS variable to a real colour for html2canvas
  const resolvedBg = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg-1").trim() || "#ffffff";

  // Remember scroll position so we can restore it afterwards
  const originalScrollY = window.scrollY;

  // Scroll element to top of viewport so html2canvas captures it correctly
  el.scrollIntoView({ block: "start" });
  await new Promise((r) => setTimeout(r, 300)); // let paint settle (SVG animations complete)

  // Expand element to full viewport width during capture so the PDF
  // makes maximum use of the A4 page width regardless of container constraints
  const originalMinWidth = el.style.minWidth;
  el.style.minWidth = `${window.innerWidth}px`;

  const captureW = el.scrollWidth;
  const captureH = Math.min(el.scrollHeight, el.offsetHeight + 40);

  let canvas;
  try {
    canvas = await html2canvas(el, {
      scale: 1.5,
      useCORS: true,
      allowTaint: false,
      logging: false,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      width: captureW,
      height: captureH,
      windowWidth: captureW,
      windowHeight: captureH,
      backgroundColor: resolvedBg,
    });
  } finally {
    el.style.minWidth = originalMinWidth;
    // Restore original scroll position
    window.scrollTo(0, originalScrollY);
  }

  return canvas;
}

function addPageContent(pdf, canvas, sectionTitle, dateStr) {
  const usableW = A4_W - MARGIN * 2;
  const usableH = A4_H - MARGIN * 2 - HEADER_H;

  const ratio = Math.min(usableW / canvas.width, usableH / canvas.height);
  const finalW = canvas.width * ratio;
  const finalH = canvas.height * ratio;

  // Centre horizontally if content is narrower than the usable width
  const xOffset = MARGIN + (usableW - finalW) / 2;
  const yOffset = MARGIN + HEADER_H;

  // Header text
  pdf.setFontSize(10);
  pdf.setTextColor(180, 180, 180);
  pdf.text(`License Lifecycle Report - ${sectionTitle}`, MARGIN, MARGIN + 10);
  pdf.text(`Generated: ${dateStr}`, A4_W - MARGIN, MARGIN + 10, { align: "right" });

  // Separator line between header and content
  pdf.setDrawColor(80, 80, 80);
  pdf.line(MARGIN, MARGIN + 16, A4_W - MARGIN, MARGIN + 16);

  // Chart image (JPEG for compact file size)
  const imgData = canvas.toDataURL("image/jpeg", 0.85);
  pdf.addImage(imgData, "JPEG", xOffset, yOffset, finalW, finalH, "", "FAST");
}

/**
 * Capture a single section element and save as a one-page PDF.
 *
 * @param {string} elementId
 * @param {string} sectionTitle
 * @param {string} filename - without .pdf
 * @param {object} [settings] - user settings ({ dateFormat?, timeZone? })
 */
export async function exportSectionPdf(elementId, sectionTitle, filename, settings) {
  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Element #${elementId} not found`);

  const { jsPDF, html2canvas } = await loadPdfDependencies();
  const canvas = await captureElement(el, html2canvas);

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  addPageContent(pdf, canvas, sectionTitle, todayStr(settings));
  pdf.save(`${filename}.pdf`);
}

/**
 * Capture multiple sections and bundle into a single multi-page PDF.
 *
 * @param {{ elementId: string, title: string }[]} sections
 * @param {string} filename - without .pdf
 * @param {object} [settings] - user settings ({ dateFormat?, timeZone? })
 */
export async function exportFullReportPdf(sections, filename, settings) {
  const dateStr = todayStr(settings);
  const { jsPDF, html2canvas } = await loadPdfDependencies();

  let pdf = null;

  for (let i = 0; i < sections.length; i++) {
    const { elementId, title } = sections[i];
    const el = document.getElementById(elementId);
    if (!el) continue;

    const canvas = await captureElement(el, html2canvas);

    if (!pdf) {
      pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    } else {
      pdf.addPage("a4", "landscape");
    }

    addPageContent(pdf, canvas, title, dateStr);
  }

  if (pdf) {
    pdf.save(`${filename}.pdf`);
  }
}

function structuredAmount(value, currency) {
  if (value === null || value === undefined || value === "") return "-";
  return formatCost(value, currency, "en-US");
}

function structuredDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function mapAmounts(values) {
  return Object.entries(values ?? {}).map(([currency, value]) => structuredAmount(value, currency)).join(" | ") || "-";
}

function addStructuredTable(pdf, title, headers, rows, state) {
  const usableW = A4_W - MARGIN * 2;
  const widths = headers.map((_, index) => usableW * (index === 0 ? 0.27 : 0.73 / Math.max(headers.length - 1, 1)));
  const rowHeight = (values) => Math.max(...values.map((value, index) => pdf.splitTextToSize(String(value ?? "-"), widths[index] - 8).length), 1) * 9 + 5;
  const drawHeader = () => {
    pdf.setFillColor(45, 50, 60);
    pdf.rect(MARGIN, state.y, usableW, 18, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(7.5);
    let x = MARGIN;
    headers.forEach((header, index) => {
      pdf.text(header, x + 4, state.y + 12);
      x += widths[index];
    });
    state.y += 18;
  };
  const newPage = () => {
    pdf.addPage("a4", "landscape");
    state.page += 1;
    state.y = MARGIN + 26;
    pdf.setFontSize(9);
    pdf.setTextColor(70, 75, 85);
    pdf.text(`LicenseTrack Report - ${title}`, MARGIN, MARGIN + 10);
    pdf.text(`Page ${state.page}`, A4_W - MARGIN, MARGIN + 10, { align: "right" });
    drawHeader();
  };

  if (state.y > A4_H - 42) newPage();
  pdf.setFontSize(12);
  pdf.setTextColor(35, 40, 50);
  pdf.text(title, MARGIN, state.y + 12);
  state.y += 20;
  drawHeader();
  pdf.setFontSize(7.5);
  (rows.length ? rows : [["No data", ...headers.slice(1).map(() => "-")]]).forEach((values, rowIndex) => {
    const height = rowHeight(values);
    if (state.y + height > A4_H - MARGIN) newPage();
    pdf.setFillColor(rowIndex % 2 ? 248 : 240, rowIndex % 2 ? 249 : 243, rowIndex % 2 ? 251 : 246);
    pdf.rect(MARGIN, state.y, usableW, height, "F");
    pdf.setTextColor(45, 48, 55);
    let x = MARGIN;
    values.forEach((value, index) => {
      const lines = pdf.splitTextToSize(String(value ?? "-"), widths[index] - 8);
      pdf.text(lines, x + 4, state.y + 10);
      x += widths[index];
    });
    state.y += height;
  });
  state.y += 14;
}

/** Generate the full report from server data as readable, paginated text/tables. */
export async function exportStructuredReportPdf(report, filename, settings) {
  const [{ jsPDF }] = await Promise.all([import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const dateStr = structuredDate(report.generatedAt) || todayStr(settings);
  const state = { page: 1, y: MARGIN + 34 };
  const filters = report.filters ?? {};
  const counts = report.counts ?? {};

  pdf.setFontSize(20);
  pdf.setTextColor(30, 35, 45);
  pdf.text("LicenseTrack Report", MARGIN, state.y);
  state.y += 18;
  pdf.setFontSize(10);
  pdf.setTextColor(90, 95, 105);
  pdf.text(`Generated: ${dateStr}`, MARGIN, state.y);
  state.y += 20;
  pdf.setFontSize(9);
  pdf.setTextColor(45, 48, 55);
  const filterText = [
    `Records: ${counts.records ?? 0}`,
    `Retired/legacy: ${filters.includeRetired ? "included" : "excluded"}`,
    `Date range: ${filters.dateRange || "all"}${filters.dateFrom ? ` (${filters.dateFrom} to ${filters.dateTo})` : ""}`,
    `Cost centres: ${(filters.costCentres ?? []).join(", ") || "all"}`,
    `Forecast: ${filters.forecastYears ?? 5} years at ${filters.annualUpliftPct ?? "0"}% uplift`,
  ];
  filterText.forEach((line) => { pdf.text(line, MARGIN, state.y); state.y += 13; });
  state.y += 5;
  pdf.setFillColor(247, 239, 211);
  pdf.rect(MARGIN, state.y, A4_W - MARGIN * 2, 28, "F");
  pdf.setTextColor(105, 75, 20);
  pdf.text(report.currencyDisclaimer || "All monetary values remain in native currencies. No conversion is applied.", MARGIN + 8, state.y + 17);
  state.y += 42;

  addStructuredTable(pdf, "Data quality", ["Metric", "Count", "Notes"], [
    ["Excluded invalid money", counts.excluded ?? 0, "Non-canonical stored values were not interpreted"],
    ["Unpriced", counts.unpriced ?? 0, "Required pricing is blank or unavailable"],
    ["Undated / unallocated", counts.undated ?? 0, "Period totals exclude recurring values without bounded coverage"],
  ], state);
  const financial = report.financialSummaries ?? {};
  addStructuredTable(pdf, "Financial summaries by native currency", ["Summary", "Currency", "Amount"], Object.entries({
    "License spend": financial.licenseSpendByCurrency,
    "PO spend": financial.poSpendByCurrency,
    "Signed difference": financial.spendDifferenceByCurrency,
    "Recurring baseline": financial.recurringAnnualCostByCurrency,
    "Unallocated / undated": financial.unallocatedValuesByCurrency,
  }).flatMap(([label, values]) => Object.entries(values ?? {}).map(([currency, amount]) => [label, currency, structuredAmount(amount, currency)])), state);

  const budget = report.budgetForecast ?? {};
  addStructuredTable(pdf, "Recurring records", ["Record", "Type", "Currency", "Annual cost"], (budget.recurringRecords ?? []).map((row) => [row.publisher || "Unknown", row.licenseType || "-", row.currency, structuredAmount(row.annualCost, row.currency)]), state);
  addStructuredTable(pdf, "Budget forecast", ["Year", "Baseline", "Growth", "Projected budget"], (budget.forecastRows ?? []).map((row) => [row.year, structuredAmount(row.baseline, budget.singleCurrency), structuredAmount(row.growthAmount, budget.singleCurrency), structuredAmount(row.projectedBudget, budget.singleCurrency)]), state);
  addStructuredTable(pdf, "Publisher summary", ["Publisher", "Currencies", "Value", "Records"], (report.publisherData ?? []).flatMap((row) => Object.entries(row.totalSpendByCurrency ?? {}).map(([currency, amount]) => [row.publisher, currency, structuredAmount(amount, currency), row.licenseCount])), state);
  addStructuredTable(pdf, "Publisher and supplier summary", ["Publisher", "Supplier", "Currency", "Value"], (report.vendorData ?? []).flatMap((row) => Object.entries(row.totalSpendByCurrency ?? {}).map(([currency, amount]) => [row.publisher, row.supplier || "-", currency, structuredAmount(amount, currency)])), state);
  addStructuredTable(pdf, "Portfolio breakdown", ["Breakdown", "Name", "Count"], [
    ...(report.portfolioData?.byType ?? []).map((row) => ["License type", row.name, row.value]),
    ...(report.portfolioData?.byMetric ?? []).map((row) => ["License metric", row.name, row.value]),
  ], state);
  addStructuredTable(pdf, "Renewal calendar", ["Quarter", "Record", "Kind", "Currency", "Renewal value", "Event date"], (report.renewalData ?? []).flatMap((quarter) => (quarter.events ?? []).map((row) => [quarter.quarterLabel, row.publisher, row.renewalKind, row.currency, structuredAmount(row.renewalValue, row.currency), structuredDate(row.eventDate)])), state);
  addStructuredTable(pdf, "Perpetual licenses and maintenance", ["Record", "Coverage", "Currency", "Purchase", "Maintenance"], (report.perpetualMaintenanceData?.rows ?? []).flatMap((row) => [
    [row.publisher, row.maintenanceSource, row.currency, structuredAmount(row.purchaseValue, row.currency), mapAmounts(row.maintenanceByCurrency)],
    ...(row.maintenanceRecords ?? []).map((child) => [`  Maintenance - ${child.publisher}`, "maintenance record", child.currency, "-", structuredAmount(child.amount, child.currency)]),
  ]), state);
  addStructuredTable(pdf, "Purchase order reconciliation", ["PO / identity", "Identity type", "Currency", "PO value", "Line value", "Signed difference"], (report.purchaseOrderData?.rows ?? []).map((row) => [row.poNumber || "No PO number", row.identityType, row.currency, structuredAmount(row.poValue, row.currency), structuredAmount(row.lineValue, row.currency), structuredAmount(row.difference, row.currency)]), state);

  pdf.save(`${filename}.pdf`);
}
