import { useState } from "react";

const normalise = (value) => String(value ?? "").trim().toLocaleLowerCase();

/**
 * Decide when to ask "Supplier changed - update the supplier contact?".
 * The prompt shows once the supplier differs from its saved value while the
 * saved contact is still in place; editing the contact, Keep or Clear answer it.
 */
export function useSupplierContactPrompt({ initialSupplier, supplier, initialContact, contact }) {
  const [answeredSupplier, setAnsweredSupplier] = useState(null);
  const supplierChanged = normalise(supplier) !== normalise(initialSupplier);
  const contactUntouched = normalise(contact) === normalise(initialContact);
  const visible = supplierChanged
    && normalise(initialContact) !== ""
    && contactUntouched
    && answeredSupplier !== normalise(supplier);

  return {
    visible,
    answer: () => setAnsweredSupplier(normalise(supplier)),
  };
}
