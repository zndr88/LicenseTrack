export function getSortValue(license, colKey) {
  switch (colKey) {
    case "licenseRef":     return license.licenseRef ?? null;
    case "externalRef":    return license.externalRef ?? null;
    case "publisher":      return license.publisherName ?? null;
    case "description":    return license.softwareDescription ?? null;
    case "contractNumber": return license.contractNumber ?? null;
    case "poNumber":       return license.poNumber ?? null;
    case "invoiceNumber":  return license.invoiceNumber ?? null;
    case "costCentre":     return license.costCentre ?? null;
    case "supplier":       return license.supplier ?? null;
    case "contactEmail":   return license.contactEmail ?? null;
    case "budgetOwnerEmail": return license.budgetOwnerEmail ?? null;
    case "licenseType":    return license.licenseType ?? null;
    case "licenseMetric":  return license.licenseMetric ?? null;
    case "quantity":       return license.quantity ? Number(license.quantity) : null;
    case "unitPrice":      return license.unitPrice ? Number(license.unitPrice) : null;
    case "currency":       return license.currency ?? null;
    case "totalPoPrice": {
      // Prefer unit * qty as a per-line numeric proxy matching displayed value
      const unit = parseFloat(String(license.unitPrice ?? "").replace(/[^0-9.]/g, ""));
      const qty  = parseFloat(String(license.quantity ?? "").replace(/[^0-9.]/g, ""));
      if (!isNaN(unit) && !isNaN(qty)) return unit * qty;
      // Fall back to raw totalPoPrice field
      if (!license.totalPoPrice) return null;
      const n = parseFloat(String(license.totalPoPrice).replace(/[^0-9.]/g, ""));
      return isNaN(n) ? null : n;
    }
    case "startDate":
    case "dates":          return license.startDate ?? null;
    case "endDate":
    case "expiration":     return license.endDate ?? null;
    case "noticeDate":     return license.noticeDate ?? null;
    case "requestDate":    return license.requestDate ?? null;
    case "purchaseDate":   return license.purchaseDate ?? null;
    case "portalUrl":      return license.portalUrl ?? null;
    case "notes":          return license.notes ?? null;
    case "docs":           return license.documentCount ?? 0;
    case "complete": return license.completeness?.percentage ?? 0;
    case "createdBy":      return license.createdByName ?? license.createdByEmail ?? license.createdBy ?? null;
    case "createdAt":      return license.createdAt ?? null;
    case "updatedAt":      return license.updatedAt ?? null;
    case "lifecycleStatus": return license.lifecycleStatus ?? null;
    case "syncStatus":     return license.syncStatus ?? null;
    case "lastSyncedAt":   return license.lastSyncedAt ?? null;
    case "maintenanceCoverage": return license.maintenanceCoverage ?? null;
    case "maintenanceStartDate": return license.maintenanceStartDate ?? null;
    case "maintenanceEndDate": return license.maintenanceEndDate ?? null;
    case "maintenanceCost": return license.maintenanceCost ? Number(license.maintenanceCost) : null;
    default: return null;
  }
}
