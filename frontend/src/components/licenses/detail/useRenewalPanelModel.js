import { getRenewalBundleMembers } from "../../../utils/renewalBundle.js";

export function useRenewalPanelModel({ license, allLicenses }) {
  const poSiblings = getRenewalBundleMembers(license, allLicenses);

  const bundleCount = poSiblings.length + 1;

  return { poSiblings, bundleCount };
}
