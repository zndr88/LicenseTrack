import { useEffect, useMemo } from "react";
import { formatPriceInput } from "../../utils/helpers.js";
import { toInputText } from "../../utils/formatting.js";
import NumberInput, { isValidNumberValue } from "../ui/NumberInput.jsx";
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

// Quantity and unit price are canonical values from NumberInput.
function multiplyCanonical(quantity, unitPrice) {
  if (!quantity || !unitPrice || !isValidNumberValue(quantity) || !isValidNumberValue(unitPrice)) return "";
  return (Number(quantity) * Number(unitPrice)).toFixed(2);
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
  embedded = false,
  hideCoverage = false,
}) {
  const canAddSeparateLine = supportsSeparateMaintenanceLine(licenseType);
  const coverageOptions = maintenanceCoverageOptionsForLicenseType(licenseType);
  const bundledIncludedSupport = isBundledIncludedSupport(licenseType, coverage);
  const numberSettings = useMemo(() => ({ numberFormatLocale: locale }), [locale]);

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
    onChange("maintenanceCost", multiplyCanonical(quantity, unitPrice));
  };

  return (
    <div className={embedded ? "maintenance-coverage-fields" : "fs"}>
      {!embedded && <h4>Maintenance</h4>}
      {!hideCoverage && <div className="fg">
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
      </div>}

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
                } else if (nextBasis === "free") {
                  // No charge: there is no cost to enter; the backend stores zero.
                  onChange("maintenanceQuantity", "");
                  onChange("maintenanceUnitPrice", "");
                  onChange("maintenanceCost", "");
                } else {
                  onChange("maintenanceQuantity", "");
                  onChange("maintenanceUnitPrice", "");
                  onChange("maintenanceCost", "");
                }
              }}
            >
              <option value="flat">Flat coverage fee</option>
              <option value="per_unit">Per covered unit</option>
              <option value="free">Free (no charge)</option>
            </select>
          </div>

          {pricingBasis === "free" ? null : (pricingBasis || "flat") === "flat" ? (
            <div className="fg">
              <label htmlFor={`${idPrefix}-maintenance-cost`}>
                Total maintenance cost <span style={{ fontWeight: 400, color: "var(--text-3)" }}>({currency}, coverage period)</span>
              </label>
              <NumberInput
                id={`${idPrefix}-maintenance-cost`}
                value={cost ?? ""}
                settings={numberSettings}
                minFractionDigits={2}
                onChange={(next) => onChange("maintenanceCost", next)}
                placeholder={toInputText("2500.00", numberSettings)}
              />
            </div>
          ) : (
            <>
              <div className="fr">
                <div className="fg">
                  <label htmlFor={`${idPrefix}-maintenance-quantity`}>Covered quantity</label>
                  <NumberInput
                    id={`${idPrefix}-maintenance-quantity`}
                    value={supportQuantity ?? ""}
                    settings={numberSettings}
                    onChange={(next) => {
                      onChange("maintenanceQuantity", next);
                      updatePerUnitTotal(next, supportUnitPrice);
                    }}
                  />
                </div>
                <div className="fg">
                  <label htmlFor={`${idPrefix}-maintenance-unit-price`}>
                    Maintenance unit price <span style={{ fontWeight: 400, color: "var(--text-3)" }}>({currency})</span>
                  </label>
                  <NumberInput
                    id={`${idPrefix}-maintenance-unit-price`}
                    value={supportUnitPrice ?? ""}
                    settings={numberSettings}
                    minFractionDigits={2}
                    onChange={(next) => {
                      onChange("maintenanceUnitPrice", next);
                      updatePerUnitTotal(supportQuantity, next);
                    }}
                    placeholder={toInputText("250.00", numberSettings)}
                  />
                </div>
              </div>
              <div className="fg">
                <label htmlFor={`${idPrefix}-maintenance-cost`}>Total maintenance cost</label>
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
