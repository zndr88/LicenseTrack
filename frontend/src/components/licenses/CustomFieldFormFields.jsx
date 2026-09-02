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
  section,
}) {
  if (loading) {
    return section === undefined ? <p className="set-muted-text">Loading custom fields...</p> : null;
  }
  const fields = section === undefined
    ? definitions
    : definitions.filter((definition) => (definition.section || "__catchall__") === section);
  if (!fields.length) return null;

  return (
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
  );
}
