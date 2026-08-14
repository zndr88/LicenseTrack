import { useEffect } from "react";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";
import {
  defaultMaintenanceCoverageForLicenseType,
  isBundledIncludedSupport,
  maintenanceCoverageOptionsForLicenseType,
  supportsMaintenanceCoverage,
  supportsSeparateMaintenanceLine,
} from "../../utils/maintenanceCoverage.js";

export function isFreewareLicenseType(licenseType) {
  return licenseType === "freeware";
}

export { supportsMaintenanceCoverage, supportsSeparateMaintenanceLine };

function multiplyCanonical(left, right, locale) {
  const settings = { numberFormatLocale: locale };
  const quantity = parseLocalizedNumber(left, settings);
  const unitPrice = parseLocalizedNumber(right, settings);
  if (quantity === null || unitPrice === null) return "";
  return (Number(quantity) * Number(unitPrice)).toFixed(2);
}

function formatLocalizedPrice(value, locale) {
  const canonical = parseLocalizedNumber(value, { numberFormatLocale: locale });
  return formatPriceInput(canonical ?? value, locale);
}

export default function MaintenanceCoverageFields({
  idPrefix,
  licenseType,
  coverage = "unknown",
  startDate = "",
  endDate = "",
  pricingBasis = "flat",
  supportQuantity = "",
  supportUnitPrice = "",
  cost = "",
  licenseQuantity = "",
  licenseStartDate = "",
  licenseEndDate = "",
  licenseTotalCost = "",
  currency = "EUR",
  locale = "en-US",
  onChange,
  onAddSeparate,
  separateLineAdded = false,
}) {
  const canAddSeparateLine = supportsSeparateMaintenanceLine(licenseType);
  const coverageOptions = maintenanceCoverageOptionsForLicenseType(licenseType);
  const bundledIncludedSupport = isBundledIncludedSupport(licenseType, coverage);

  useEffect(() => {
    if (!supportsMaintenanceCoverage(licenseType) || coverage !== "separately_tracked" || canAddSeparateLine) return;
    onChange("maintenanceCoverage", defaultMaintenanceCoverageForLicenseType(licenseType));
    onChange("maintenanceStartDate", "");
    onChange("maintenanceEndDate", "");
    onChange("maintenancePricingBasis", "flat");
    onChange("maintenanceQuantity", "");
    onChange("maintenanceUnitPrice", "");
    onChange("maintenanceCost", "");
  }, [coverage, canAddSeparateLine, licenseType, onChange]);

  useEffect(() => {
    if (!bundledIncludedSupport) return;
    const nextStartDate = licenseStartDate || "";
    const nextEndDate = licenseEndDate || "";
    const nextCost = licenseTotalCost || "";
    if ((startDate || "") !== nextStartDate) {
      onChange("maintenanceStartDate", nextStartDate);
    }
    if ((endDate || "") !== nextEndDate) {
      onChange("maintenanceEndDate", nextEndDate);
    }
    if ((pricingBasis || "flat") !== "flat") {
      onChange("maintenancePricingBasis", "flat");
    }
    if (supportQuantity) {
      onChange("maintenanceQuantity", "");
    }
    if (supportUnitPrice) {
      onChange("maintenanceUnitPrice", "");
    }
    if ((cost || "") !== nextCost) {
      onChange("maintenanceCost", nextCost);
    }
  }, [
    bundledIncludedSupport,
    cost,
    endDate,
    licenseEndDate,
    licenseStartDate,
    licenseTotalCost,
    onChange,
    pricingBasis,
    startDate,
    supportQuantity,
    supportUnitPrice,
  ]);

  if (!supportsMaintenanceCoverage(licenseType)) return null;

  const updatePerUnitTotal = (quantity, unitPrice) => {
    onChange("maintenanceCost", multiplyCanonical(quantity, unitPrice, locale));
  };

  return (
    <div className="fs">
      <h4>Maintenance / Support</h4>
      <div className="fg">
        <label htmlFor={`${idPrefix}-maintenance-coverage`}>Coverage</label>
        <select
          id={`${idPrefix}-maintenance-coverage`}
          className="fi fi-select"
          value={coverage || "unknown"}
          onChange={(event) => {
            const nextCoverage = event.target.value;
            onChange("maintenanceCoverage", nextCoverage);
            if (nextCoverage !== "included") {
              onChange("maintenanceStartDate", "");
              onChange("maintenanceEndDate", "");
              onChange("maintenancePricingBasis", "flat");
              onChange("maintenanceQuantity", "");
              onChange("maintenanceUnitPrice", "");
              onChange("maintenanceCost", "");
            }
          }}
        >
          {coverageOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {coverage === "included" && !bundledIncludedSupport && (
        <>
          <div className="fr">
            <div className="fg">
              <label htmlFor={`${idPrefix}-maintenance-start`}>Coverage Start</label>
              <input
                id={`${idPrefix}-maintenance-start`}
                className="fi"
                type="date"
                value={startDate || ""}
                onChange={(event) => onChange("maintenanceStartDate", event.target.value)}
              />
            </div>
            <div className="fg">
              <label htmlFor={`${idPrefix}-maintenance-end`}>Coverage End</label>
              <input
                id={`${idPrefix}-maintenance-end`}
                className="fi"
                type="date"
                value={endDate || ""}
                onChange={(event) => onChange("maintenanceEndDate", event.target.value)}
              />
            </div>
          </div>
          <div className="fg">
            <label htmlFor={`${idPrefix}-maintenance-pricing-basis`}>Pricing basis</label>
            <select
              id={`${idPrefix}-maintenance-pricing-basis`}
              className="fi fi-select"
              value={pricingBasis || "flat"}
              onChange={(event) => {
                const nextBasis = event.target.value;
                onChange("maintenancePricingBasis", nextBasis);
                if (nextBasis === "per_unit") {
                  const nextQuantity = supportQuantity || licenseQuantity || "";
                  onChange("maintenanceQuantity", nextQuantity);
                  updatePerUnitTotal(nextQuantity, supportUnitPrice);
                } else {
                  onChange("maintenanceQuantity", "");
                  onChange("maintenanceUnitPrice", "");
                  onChange("maintenanceCost", "");
                }
              }}
            >
              <option value="flat">Flat coverage fee</option>
              <option value="per_unit">Per covered unit</option>
            </select>
          </div>

          {(pricingBasis || "flat") === "flat" ? (
            <div className="fg">
              <label htmlFor={`${idPrefix}-maintenance-cost`}>
                Total support cost <span style={{ fontWeight: 400, color: "var(--text-3)" }}>({currency}, coverage period)</span>
              </label>
              <input
                id={`${idPrefix}-maintenance-cost`}
                className="fi"
                value={cost ?? ""}
                onChange={(event) => onChange("maintenanceCost", event.target.value)}
                onBlur={(event) => onChange(
                  "maintenanceCost",
                  formatLocalizedPrice(event.target.value, locale)
                )}
                placeholder={formatPriceInput("2500.00", locale)}
              />
            </div>
          ) : (
            <>
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`${idPrefix}-maintenance-quantity`}>Covered quantity</label>
                  <input
                    id={`${idPrefix}-maintenance-quantity`}
                    className="fi"
                    value={supportQuantity ?? ""}
                    onChange={(event) => {
                      onChange("maintenanceQuantity", event.target.value);
                      updatePerUnitTotal(event.target.value, supportUnitPrice);
                    }}
                  />
                </div>
                <div className="fg">
                  <label htmlFor={`${idPrefix}-maintenance-unit-price`}>
                    Support unit price <span style={{ fontWeight: 400, color: "var(--text-3)" }}>({currency})</span>
                  </label>
                  <input
                    id={`${idPrefix}-maintenance-unit-price`}
                    className="fi"
                    value={supportUnitPrice ?? ""}
                    onChange={(event) => {
                      onChange("maintenanceUnitPrice", event.target.value);
                      updatePerUnitTotal(supportQuantity, event.target.value);
                    }}
                    onBlur={(event) => onChange(
                      "maintenanceUnitPrice",
                      formatLocalizedPrice(event.target.value, locale)
                    )}
                    placeholder={formatPriceInput("250.00", locale)}
                  />
                </div>
              </div>
              <div className="fg">
                <label htmlFor={`${idPrefix}-maintenance-cost`}>Total support cost</label>
                <input
                  id={`${idPrefix}-maintenance-cost`}
                  className="fi"
                  value={formatPriceInput(cost, locale)}
                  readOnly
                />
              </div>
            </>
          )}
        </>
      )}

      {coverage === "separately_tracked" && canAddSeparateLine && onAddSeparate && (
        <button
          type="button"
          className="btn btn-g"
          disabled={separateLineAdded}
          onClick={onAddSeparate}
        >
          {separateLineAdded ? "Maintenance line added" : "Add maintenance line"}
        </button>
      )}
    </div>
  );
}
