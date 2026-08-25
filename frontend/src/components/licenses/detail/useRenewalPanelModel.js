import { getRenewalBundleMembers } from "../../../utils/renewalBundle.js";

export function useRenewalPanelModel({ license, allLicenses, globalSettings }) {
  const poSiblings = getRenewalBundleMembers(
    license,
    allLicenses,
    globalSettings.notificationDays,
  );

  const bundleCount = poSiblings.length + 1;

  return { poSiblings, bundleCount };
}
