import CustomFieldFormFields from "./CustomFieldFormFields.jsx";
import LicenseFormSection from "./LicenseFormSection.jsx";

export function hasCustomFieldsInSection(definitions = [], section) {
  return definitions.some((definition) => (definition.section || "__catchall__") === section);
}

export function CustomFieldPlacement(props) {
  return <CustomFieldFormFields {...props} />;
}

export default function CustomFieldFormSection({ title, icon, section, ...fieldProps }) {
  if (!hasCustomFieldsInSection(fieldProps.definitions, section)) return null;
  return (
    <LicenseFormSection title={title} icon={icon}>
      <CustomFieldPlacement {...fieldProps} section={section} />
    </LicenseFormSection>
  );
}
