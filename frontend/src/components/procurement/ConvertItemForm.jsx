import React, { useState } from "react";
import { Controller } from "react-hook-form";
import { LICENSE_TYPES, LICENSE_METRICS, CURRENCIES } from "../../constants/licenseData.js";
import Checkbox from "../ui/Checkbox.jsx";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import ParentLicensePicker from "./ParentLicensePicker.jsx";

/**
 * Determines whether a watched form item has all required fields filled.
 * Exported so ConvertAllModal can compute allReady for the submit button.
 */
export function isItemReady(item) {
  if (!item) return false;
  return Boolean(
    item.publisherName?.trim() &&
    item.softwareDescription?.trim() &&
    item.startDate &&
    (item.isPerpetual || item.endDate) &&
    (item.licenseType !== "maintenance" || item.parentLicenseId || item.parentSourcingItemId) &&
    item.quantity?.toString().trim() !== "" &&
    item.unitPrice?.toString().trim() !== ""
  );
}

/**
 * Single item card inside ConvertAllModal.
 * Owns its own expand/collapse and price-display state.
 */
export default function ConvertItemForm({
  idx,
  sourcingItem,
  poItems = [],
  watchedItems = [],
  licenses = [],
  watchedItem,
  errors,
  control,
  register,
  setValue,
  locale,
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [unitPriceDisplay, setUnitPriceDisplay] = useState(
    () => formatPriceInput(sourcingItem.estimatedUnitPrice || "", locale)
  );
  const [totalPriceDisplay, setTotalPriceDisplay] = useState(
    () => formatPriceInput(sourcingItem.estimatedTotalPrice || "", locale)
  );

  const wi = watchedItem ?? {};
  const ready = isItemReady(wi);
  const itemErrors = errors;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", marginBottom: 12 }}>
      {/* Section header */}
      <div
        style={{
          padding: "10px 14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg-2)",
          borderRadius: isExpanded ? "var(--r) var(--r) 0 0" : "var(--r)",
        }}
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>
            {isExpanded ? "▾" : "▸"}
          </span>
          <span style={{ fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
            {wi.publisherName || `Item ${idx + 1}`}
          </span>
          {wi.softwareDescription && (
            <span style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {wi.softwareDescription}
            </span>
          )}
          {sourcingItem.isRenewal && (
            <span style={{ flexShrink: 0, padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600, background: "var(--purple-dim)", color: "var(--purple-text)", border: "1px solid var(--purple-border)" }}>
              Renewal
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, flexShrink: 0, marginLeft: 12, fontWeight: 600, color: ready ? "var(--green)" : "var(--text-3)" }}>
          {ready ? "✓ Ready" : "Incomplete"}
        </span>
      </div>

      {/* Section body */}
      {isExpanded && (
        <div style={{ padding: "12px 14px" }}>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-publisher-name-${idx}`}>Publisher Name <span style={{ color: "var(--red)" }}>*</span></label>
              <input id={`ca-publisher-name-${idx}`} className="fi" {...register(`items.${idx}.publisherName`)} />
            </div>
            <div className="fg">
              <label htmlFor={`ca-software-desc-${idx}`}>Software Description <span style={{ color: "var(--red)" }}>*</span></label>
              <input id={`ca-software-desc-${idx}`} className="fi" {...register(`items.${idx}.softwareDescription`)} />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-start-date-${idx}`}>Start Date <span style={{ color: "var(--red)" }}>*</span></label>
              <input id={`ca-start-date-${idx}`} type="date" className="fi" {...register(`items.${idx}.startDate`)} />
            </div>
            <div className="fg">
              <label htmlFor={`ca-end-date-${idx}`}>End Date</label>
              {wi.isPerpetual
                ? <input className="fi" value="Perpetual" disabled />
                : <input id={`ca-end-date-${idx}`} type="date" className="fi" {...register(`items.${idx}.endDate`)} />
              }
              <div style={{ marginTop: 5 }}>
                <Controller
                  control={control}
                  name={`items.${idx}.isPerpetual`}
                  render={({ field: f }) => (
                    <Checkbox
                      checked={f.value}
                      onChange={(v) => {
                        f.onChange(v);
                        if (v) {
                          setValue(`items.${idx}.endDate`, "", { shouldDirty: true });
                          setValue(`items.${idx}.licenseType`, "perpetual", { shouldDirty: true });
                          setValue(`items.${idx}.portalUrl`, "", { shouldDirty: true });
                          setValue(`items.${idx}.parentLicenseId`, "", { shouldDirty: true });
                          setValue(`items.${idx}.parentSourcingItemId`, "", { shouldDirty: true });
                        } else if (wi.licenseType === "perpetual") {
                          setValue(`items.${idx}.licenseType`, "subscription", { shouldDirty: true });
                        }
                      }}
                      label="Perpetual license"
                    />
                  )}
                />
              </div>
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-contract-number-${idx}`}>Contract Number</label>
              <input id={`ca-contract-number-${idx}`} className="fi" {...register(`items.${idx}.contractNumber`)} />
            </div>
            <div className="fg">
              <label htmlFor={`ca-po-number-${idx}`}>PO Number</label>
              <input id={`ca-po-number-${idx}`} className="fi" value={wi.poNumber ?? ""} disabled style={{ opacity: 0.6 }} />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-invoice-number-${idx}`}>Invoice Number</label>
              <input id={`ca-invoice-number-${idx}`} className="fi" {...register(`items.${idx}.invoiceNumber`)} />
            </div>
            <div className="fg">
              <label htmlFor={`ca-contact-email-${idx}`}>Contact Email</label>
              <input id={`ca-contact-email-${idx}`} className="fi" {...register(`items.${idx}.contactEmail`)} />
              {itemErrors?.contactEmail && <span className="field-error">{itemErrors.contactEmail.message}</span>}
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-supplier-${idx}`}>Supplier</label>
              <input id={`ca-supplier-${idx}`} className="fi" {...register(`items.${idx}.supplier`)} />
            </div>
            <div className="fg">
              <label htmlFor={`ca-cost-centre-${idx}`}>Cost Centre</label>
              <input id={`ca-cost-centre-${idx}`} className="fi" {...register(`items.${idx}.costCentre`)} />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-license-type-${idx}`}>License Type</label>
              <select
                id={`ca-license-type-${idx}`}
                className="fi fi-select"
                {...register(`items.${idx}.licenseType`, {
                  onChange: (e) => {
                    const nextType = e.target.value;
                    if (nextType !== "saas") {
                      setValue(`items.${idx}.portalUrl`, "", { shouldDirty: true });
                    }
                    if (nextType !== "maintenance") {
                      setValue(`items.${idx}.parentLicenseId`, "", { shouldDirty: true });
                      setValue(`items.${idx}.parentSourcingItemId`, "", { shouldDirty: true });
                    }
                    if (nextType === "perpetual") {
                      setValue(`items.${idx}.isPerpetual`, true, { shouldDirty: true });
                      setValue(`items.${idx}.endDate`, "", { shouldDirty: true });
                    } else if (wi.isPerpetual) {
                      setValue(`items.${idx}.isPerpetual`, false, { shouldDirty: true });
                    }
                  },
                })}
              >
                {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="fg">
              <label htmlFor={`ca-license-metric-${idx}`}>License Metric</label>
              <select id={`ca-license-metric-${idx}`} className="fi fi-select" {...register(`items.${idx}.licenseMetric`)}>
                {LICENSE_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          {wi.licenseType === "saas" && (
            <div className="fg">
              <label htmlFor={`ca-portal-url-${idx}`}>Portal URL</label>
              <input id={`ca-portal-url-${idx}`} className="fi" placeholder="https://..." {...register(`items.${idx}.portalUrl`)} />
            </div>
          )}
          {wi.licenseType === "maintenance" && (
            <ParentLicensePicker
              id={`ca-parent-license-${idx}`}
              licenses={licenses}
              poItems={poItems}
              currentIndex={idx}
              watchedItems={watchedItems}
              parentLicenseId={wi.parentLicenseId}
              parentSourcingItemId={wi.parentSourcingItemId}
              onSelectExisting={(value) => {
                setValue(`items.${idx}.parentLicenseId`, value, { shouldDirty: true });
                setValue(`items.${idx}.parentSourcingItemId`, "", { shouldDirty: true });
              }}
              onSelectPoItem={(value) => {
                setValue(`items.${idx}.parentSourcingItemId`, value, { shouldDirty: true });
                setValue(`items.${idx}.parentLicenseId`, "", { shouldDirty: true });
              }}
              error={itemErrors?.parentLicenseId?.message || itemErrors?.parentSourcingItemId?.message}
            />
          )}
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-quantity-${idx}`}>Purchase Quantity <span style={{ color: "var(--red)" }}>*</span></label>
              <input id={`ca-quantity-${idx}`} className="fi" {...register(`items.${idx}.quantity`)} />
            </div>
            <div className="fg">
              <label htmlFor={`ca-sku-code-${idx}`}>SKU Code</label>
              <input id={`ca-sku-code-${idx}`} className="fi" placeholder="SKU or product code" {...register(`items.${idx}.skuCode`)} />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-unit-price-${idx}`}>Unit Price <span style={{ color: "var(--red)" }}>*</span></label>
              <Controller
                control={control}
                name={`items.${idx}.unitPrice`}
                render={({ field: f }) => (
                  <input
                    id={`ca-unit-price-${idx}`}
                    className="fi"
                    value={unitPriceDisplay}
                    onFocus={() => setUnitPriceDisplay(f.value)}
                    onChange={(e) => {
                      setUnitPriceDisplay(e.target.value);
                      f.onChange(parseLocalizedNumber(e.target.value, { numberFormatLocale: locale }) ?? e.target.value);
                    }}
                    onBlur={() => setUnitPriceDisplay(formatPriceInput(f.value, locale))}
                  />
                )}
              />
            </div>
            <div className="fg">
              <label htmlFor={`ca-total-price-${idx}`}>Total PO Price</label>
              <Controller
                control={control}
                name={`items.${idx}.totalPoPrice`}
                render={({ field: f }) => (
                  <input
                    id={`ca-total-price-${idx}`}
                    className="fi"
                    value={totalPriceDisplay}
                    onFocus={() => setTotalPriceDisplay(f.value)}
                    onChange={(e) => {
                      setTotalPriceDisplay(e.target.value);
                      f.onChange(parseLocalizedNumber(e.target.value, { numberFormatLocale: locale }) ?? e.target.value);
                    }}
                    onBlur={() => setTotalPriceDisplay(formatPriceInput(f.value, locale))}
                  />
                )}
              />
            </div>
          </div>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`ca-currency-${idx}`}>Currency</label>
              <select id={`ca-currency-${idx}`} className="fi fi-select" {...register(`items.${idx}.currency`)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg">
              <label htmlFor={`ca-budget-owner-${idx}`}>Budget Owner Email</label>
              <input id={`ca-budget-owner-${idx}`} className="fi" placeholder="owner@example.com" {...register(`items.${idx}.budgetOwnerEmail`)} />
              {itemErrors?.budgetOwnerEmail && <span className="field-error">{itemErrors.budgetOwnerEmail.message}</span>}
            </div>
          </div>
          <div className="fg">
            <label htmlFor={`ca-notes-${idx}`}>Notes / Comments</label>
            <textarea
              id={`ca-notes-${idx}`}
              className="fi"
              rows={4}
              style={{ resize: "vertical" }}
              {...register(`items.${idx}.notes`)}
            />
          </div>

        </div>
      )}
    </div>
  );
}
