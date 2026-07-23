/**
 * Shared Zod schemas for procurement modals.
 * Import these into individual modals rather than duplicating the definitions.
 */
import { z } from "zod";

const optionalEmail = z.string().refine(
  (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  { message: "Must be a valid email address." }
);

/** PendingOrderModal + ConvertSourcingModal (new-PO mode). */
export const poFormSchema = z.object({
  poNumber: z.string().min(1, "PO Number is required."),
  supplier: z.string(),
  notes:    z.string(),
});

/** ConvertPendingOrderModal - one-license form. */
export const licenseFormSchema = z.object({
  publisherName:       z.string().min(1, "Publisher is required."),
  softwareDescription: z.string().min(1, "Software description is required."),
  startDate:           z.string(),
  endDate:             z.string(),
  purchaseDate:        z.string(),
  isPerpetual:         z.boolean(),
  contractNumber:      z.string(),
  poNumber:            z.string(),
  invoiceNumber:       z.string(),
  contactEmail:        optionalEmail,
  supplier:            z.string(),
  costCentre:          z.string(),
  licenseType:         z.string(),
  licenseMetric:       z.string(),
  portalUrl:           z.string(),
  parentLicenseId:     z.union([z.string(), z.number()]).optional(),
  parentSourcingItemId: z.union([z.string(), z.number()]).optional(),
  maintenanceCoverage: z.string(),
  maintenanceStartDate: z.string(),
  maintenanceEndDate:  z.string(),
  maintenancePricingBasis: z.string(),
  maintenanceQuantity: z.string(),
  maintenanceUnitPrice: z.string(),
  maintenanceCost:     z.string(),
  quantity:            z.string(),
  skuCode:             z.string(),
  unitPrice:           z.string(),
  totalPoPrice:        z.string(),
  currency:            z.string(),
  budgetOwnerEmail:    optionalEmail,
  notes:               z.string(),
});

/** ConvertAllModal - one item per sourcing row (adds array-only fields). */
export const convertAllItemSchema = licenseFormSchema.extend({
  sourcingItemId: z.number(),
  isRenewal:      z.boolean(),
});
