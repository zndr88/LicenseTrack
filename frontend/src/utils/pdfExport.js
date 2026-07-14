import { formatDate } from "./formatting.js";

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
