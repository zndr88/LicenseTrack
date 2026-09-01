import { getCustomFieldSectionLabel } from "../../utils/customFieldPresentation.js";

function CustomFieldInput({ definition, value, onChange, idPrefix }) {
  const id = `${idPrefix}-custom-${definition.id}`;
  if (definition.fieldType === "boolean") {
    return (
      <select id={id} className="fi fi-select" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Blank</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }
  return (
    <input
      id={id}
      className="fi"
      type={definition.fieldType === "date" ? "date" : "text"}
      inputMode={definition.fieldType === "currency" ? "decimal" : undefined}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function CustomFieldFormFields({
  definitions,
  values,
  onChange,
  idPrefix,
  loading = false,
}) {
  if (loading) return <p className="set-muted-text">Loading custom fields...</p>;
  if (!definitions.length) return null;

  const grouped = definitions.reduce((groups, definition) => {
    const section = definition.section || "__catchall__";
    groups[section] = [...(groups[section] || []), definition];
    return groups;
  }, {});

  return Object.entries(grouped).map(([section, fields]) => (
    <fieldset className="fs" key={section}>
      <legend>{getCustomFieldSectionLabel(section)}</legend>
      <div className="fr">
        {fields.map((definition) => (
          <div className="fg" key={definition.id}>
            <label htmlFor={`${idPrefix}-custom-${definition.id}`}>{definition.name}</label>
            <CustomFieldInput
              definition={definition}
              value={values[definition.id]}
              onChange={(value) => onChange({ ...values, [definition.id]: value })}
              idPrefix={idPrefix}
            />
          </div>
        ))}
      </div>
    </fieldset>
  ));
}
