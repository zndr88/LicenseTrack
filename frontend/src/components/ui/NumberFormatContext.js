import { createContext, useContext } from "react";

// The signed-in user's number format ({ numberFormatLocale }), provided once
// at the app root. NumberInput uses it when a form doesn't pass settings.
export const NumberFormatContext = createContext(null);

export function useNumberFormatSettings() {
  return useContext(NumberFormatContext);
}
