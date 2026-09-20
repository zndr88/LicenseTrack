function nextDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nextYearDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth();
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function nextTermDraft(item) {
  return {
    ...item,
    id: undefined,
    isRenewal: true,
    renewalForLicenseId: null,
    startDate: nextDate(item.endDate),
    endDate: nextYearDate(item.endDate),
    invoiceNumber: "",
    purchaseDate: "",
    noticeDate: "",
    successorSourcingItemId: null,
  };
}
