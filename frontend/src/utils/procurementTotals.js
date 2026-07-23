export function procurementLineTotal(item) {
  const acquisition = item?.estimatedTotalPrice;
  const support = item?.maintenanceCoverage === "included" ? item?.maintenanceCost : null;
  const hasAcquisition = acquisition !== null && acquisition !== undefined && acquisition !== "";
  const hasSupport = support !== null && support !== undefined && support !== "";
  if (!hasAcquisition && !hasSupport) return null;

  const acquisitionValue = hasAcquisition ? Number(acquisition) : 0;
  const supportValue = hasSupport ? Number(support) : 0;
  if (Number.isNaN(acquisitionValue) && Number.isNaN(supportValue)) return null;
  return (Number.isNaN(acquisitionValue) ? 0 : acquisitionValue) +
    (Number.isNaN(supportValue) ? 0 : supportValue);
}
