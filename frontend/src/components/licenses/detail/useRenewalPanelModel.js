import { getExpirationStatus } from "../../../utils/helpers.js";

export function useRenewalPanelModel({ license, allLicenses, globalSettings }) {
  const poSiblings = license.poNumber
    ? allLicenses
        .filter(
          (l) =>
            l.poNumber === license.poNumber &&
            l.endDate === license.endDate &&
            l.id !== license.id &&
            !l.renewedToId &&
            !l.retired &&
            l.lifecycleStatus !== "pending_renewal"
        )
        .filter((l) => {
          const s = getExpirationStatus(
            l.endDate,
            globalSettings.notificationDays,
            l.retired,
            l.lifecycleStatus,
            l.renewedToId,
            l.startDate
          );
          return s.status === "expiring" || s.status === "expired";
        })
    : [];

  const bundleCount = poSiblings.length + 1;

  return { poSiblings, bundleCount };
}
