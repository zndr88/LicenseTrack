import { MAINTENANCE_COVERAGE_OPTIONS } from "../../constants/licenseData.js";
import { formatPriceInput } from "../../utils/helpers.js";
import { parseLocalizedNumber } from "../../utils/formatting.js";

const ELIGIBLE_LICENSE_TYPES = new Set(["freeware", "perpetual", "oem"]);

export function supportsMaintenanceCoverage(licenseType) {
  return ELIGIBLE_LICENSE_TYPES.has(licenseType);
}

export function isFreewareLicenseType(licenseType) {
  return licenseType === "freeware";
}

function multiplyCanonical(left, right, locale) {
  const settings = { numberFormatLocale: locale };
  const quantity = parseLocalizedNumber(left, settings);
  const unitPrice = parseLocalizedNumber(right, settings);
  if (quantity === null || unitPrice === null) return "";
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
  currency = "EUR",
  locale = "en-US",
  onChange,
  onAddSeparate,
  separateLineAdded = false,
}) {
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
          {MAINTENANCE_COVERAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {coverage === "included" && (
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
                onBlur={(event) => onChange("maintenanceCost", formatPriceInput(event.target.value, locale))}
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
                      formatPriceInput(event.target.value, locale)
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

      {coverage === "separately_tracked" && onAddSeparate && (
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
