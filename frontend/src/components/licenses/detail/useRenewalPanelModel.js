import { getRenewalActionDays, getRenewalBundleMembers } from "../../../utils/renewalBundle.js";

export function useRenewalPanelModel({ license, allLicenses, globalSettings }) {
  const actionDays = getRenewalActionDays(globalSettings);
  const poSiblings = getRenewalBundleMembers(license, allLicenses, actionDays);

  const bundleCount = poSiblings.length + 1;

  return { poSiblings, bundleCount, actionDays };
}
