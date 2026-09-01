/**
 * Shared Zod schemas for procurement modals.
 * Import these into individual modals rather than duplicating the definitions.
 */
import { z } from "zod";
import { CURRENCIES, LICENSE_TYPES } from "../constants/licenseData.js";
import { parseLocalizedNumber } from "./formatting.js";

const optionalEmail = z.string().refine(
  (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  { message: "Must be a valid email address." }
);

/** PendingOrderModal + ConvertSourcingModal (new-PO mode). */
export const poFormSchema = z.object({
  poNumber: z.string(),
  procurementReference: z.string(),
  supplier: z.string(),
  notes:    z.string(),
});

/** ConvertPendingOrderModal - one-license form. */
export const licenseFormSchema = z.object({
  publisherName:       z.string().min(1, "Publisher is required."),
  softwareDescription: z.string().min(1, "Software description is required."),
  startDate:           z.string(),
  endDate:             z.string(),
  noticeDate:          z.string(),
  purchaseDate:        z.string(),
  isPerpetual:         z.boolean(),
  contractNumber:      z.string(),
  poNumber:            z.string(),
  procurementReference: z.string(),
  invoiceNumber:       z.string(),
  externalRef:         z.string(),
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
  quantityPerUnit:     z.string(),
  skuCode:             z.string(),
  unitPrice:           z.string(),
  totalPoPrice:        z.string(),
  currency:            z.string(),
  budgetOwnerEmail:    optionalEmail,
  secondaryContacts:   z.string(),
  notes:               z.string(),
  customFieldValues:   z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

const sourcingRequestLineSchema = (settings) => {
  const optionalNumber = z.string().refine(
    (value) => !value || parseLocalizedNumber(value, settings) !== null,
    { message: "Enter a valid number." },
  );
  return z.object({
    id: z.number(),
    status: z.string().nullable(),
    publisherName: z.string(),
    softwareDescription: z.string(),
    licenseType: z.union([z.literal(""), z.enum(LICENSE_TYPES.map((option) => option.value))]),
    licenseMetric: z.string(),
    portalUrl: z.string(),
    quantity: optionalNumber,
    quantityPerUnit: optionalNumber,
    skuCode: z.string(),
    estimatedUnitPrice: optionalNumber,
    estimatedTotalPrice: optionalNumber,
    currency: z.enum(CURRENCIES),
    startDate: z.string(),
    endDate: z.string(),
    noticeDate: z.string(),
    purchaseDate: z.string(),
    contractNumber: z.string(),
    invoiceNumber: z.string(),
    externalRef: z.string(),
    costCentre: z.string(),
    budgetOwnerEmail: z.string(),
    secondaryContacts: z.string(),
    customFieldValues: z.record(z.string(), z.union([z.string(), z.boolean()])),
    notes: z.string(),
  }).superRefine((item, context) => {
    if (["converted", "cancelled"].includes(item.status)) return;
    if (!item.publisherName.trim()) {
      context.addIssue({ code: "custom", path: ["publisherName"], message: "Publisher is required." });
    }
    if (!item.softwareDescription.trim()) {
      context.addIssue({ code: "custom", path: ["softwareDescription"], message: "Software description is required." });
    }
  });
};

export const createSourcingRequestEditSchema = (settings) => z.object({
  supplier: z.string(),
  contactEmail: optionalEmail,
  notes: z.string(),
  items: z.array(sourcingRequestLineSchema(settings)),
});
