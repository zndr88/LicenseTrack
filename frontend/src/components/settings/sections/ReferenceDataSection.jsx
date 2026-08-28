import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addReferenceAlias,
  createReference,
  deleteReference,
  deleteReferenceAlias,
  listReferenceData,
  mergeReferences,
  previewReferenceMerge,
  setReferenceActive,
  updateReference,
} from "../../../api/referenceData.js";
import { queryKeys } from "../../../queryKeys.js";
import { invalidateReferenceData } from "../../../queryInvalidation.js";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import Icon from "../../ui/Icon.jsx";
import ReferenceCombobox from "../../ui/ReferenceCombobox.jsx";
import { SectionHeader } from "../SectionShared.jsx";

const EMPTY = [];
const PAGE_SIZE = 40;

function usageLabel(item, kind) {
  if (kind === "organization") {
    return `${item.usage?.total ?? 0} linked record${item.usage?.total === 1 ? "" : "s"}`;
  }
  return `${item.usage?.licenses ?? 0} license${item.usage?.licenses === 1 ? "" : "s"} · ${item.usage?.assignedViewers ?? 0} viewer assignment${item.usage?.assignedViewers === 1 ? "" : "s"}`;
}

function roleLabel(item) {
  if (item.isPublisher && item.isSupplier) return "Publisher · Supplier";
  if (item.isPublisher) return "Publisher";
  if (item.isSupplier) return "Supplier";
  return "No role";
}

function ReferenceList({ kind, items, search, onSearch, onError, onToast }) {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(true);
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [aliasDrafts, setAliasDrafts] = useState({});
  const [pending, setPending] = useState(null);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const visibleItems = useMemo(() => items.filter((item) => (
    (showInactive || item.isActive) && (!unusedOnly || (item.usage?.total ?? 0) === 0)
  )), [items, showInactive, unusedOnly]);
  const displayedItems = visibleItems.slice(0, visibleLimit);

  useEffect(() => setVisibleLimit(PAGE_SIZE), [search, showInactive, unusedOnly]);

  const refresh = async () => {
    await invalidateReferenceData(queryClient);
  };

  const run = async (operation, successMessage) => {
    const result = await operation();
    if (result?.error) onError(result.error);
    else {
      await refresh();
      if (successMessage) onToast(successMessage, "info");
    }
    setPending(null);
    return result;
  };

  const saveRename = async (item) => {
    if (!editingName.trim()) return;
    const nextName = editingName.trim();
    if (nextName === item.name) {
      setEditingId(null);
      setEditingName("");
      return;
    }
    setPending({ type: "rename", item, nextName });
  };

  const addAlias = async (item) => {
    const name = (aliasDrafts[item.id] || "").trim();
    if (!name) return;
    const result = await run(() => addReferenceAlias(kind, item.id, name), "Alias added.");
    if (!result?.error) setAliasDrafts((current) => ({ ...current, [item.id]: "" }));
  };

  const mergeSource = pending?.type === "merge" ? pending.item : null;

  return (
    <div className="set-reference-panel">
      <div className="set-reference-toolbar">
        <div className="set-reference-search-wrap">
          <Icon name="search" size={14} />
          <input className="fi set-reference-search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={`Search ${kind === "organization" ? "companies" : "cost centres"}`} aria-label={`Search ${kind === "organization" ? "companies" : "cost centres"}`} />
        </div>
        <label className="set-reference-toggle"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive</label>
        <label className="set-reference-toggle"><input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} /> Unused only</label>
      </div>
      {visibleItems.length === 0 ? (
        <p className="set-muted-text set-list-empty">No matching {kind === "organization" ? "companies" : "cost centres"}.</p>
      ) : (
        <div className="set-reference-list">
          {displayedItems.map((item) => (
            <div className={`set-reference-row${item.isActive ? "" : " is-inactive"}`} key={item.id}>
              <div className="set-reference-main">
                {editingId === item.id ? (
                  <div className="set-reference-inline-edit">
                    <input className="fi set-compact-input" value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveRename(item); if (event.key === "Escape") setEditingId(null); }} autoFocus aria-label={`Rename ${item.name}`} />
                    <button type="button" className="btn btn-p set-compact-button" onClick={() => saveRename(item)}>Save</button>
                    <button type="button" className="btn btn-g set-compact-button" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="set-reference-title"><strong>{item.name}</strong>{!item.isActive && <span className="set-reference-status">Inactive</span>}</div>
                )}
                <div className="set-reference-meta">{kind === "organization" ? roleLabel(item) : "Department / cost centre"} · {usageLabel(item, kind)}</div>
                {kind === "organization" && <div className="set-reference-role-checks set-reference-existing-roles">
                  <label><input type="checkbox" checked={!!item.isPublisher} onChange={(event) => run(() => updateReference(kind, item.id, { isPublisher: event.target.checked }), "Publisher role updated.")} /> Publisher</label>
                  <label><input type="checkbox" checked={!!item.isSupplier} onChange={(event) => run(() => updateReference(kind, item.id, { isSupplier: event.target.checked }), "Supplier role updated.")} /> Supplier</label>
                </div>}
                <div className="set-reference-aliases">
                  {(item.aliases || []).map((alias) => (
                    <span className="set-reference-alias" key={alias.id || alias.name}>{alias.name}<button type="button" onClick={() => setPending({ type: "deleteAlias", item, alias })} aria-label={`Remove alias ${alias.name}`} title={`Remove alias ${alias.name}`}><Icon name="x" size={10} /></button></span>
                  ))}
                  <div className="set-reference-alias-add">
                    <input className="fi set-compact-input" value={aliasDrafts[item.id] || ""} onChange={(event) => setAliasDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Add alias" aria-label={`Add alias for ${item.name}`} onKeyDown={(event) => { if (event.key === "Enter") addAlias(item); }} />
                    <button type="button" className="btn btn-g set-compact-button" disabled={!(aliasDrafts[item.id] || "").trim()} onClick={() => addAlias(item)}>Add</button>
                  </div>
                </div>
              </div>
              <div className="set-reference-actions">
                <button type="button" className="btn btn-g set-compact-button" onClick={() => { setEditingId(item.id); setEditingName(item.name); }}>Rename</button>
                <button type="button" className="btn btn-g set-compact-button" onClick={() => item.isActive ? setPending({ type: "deactivate", item }) : run(() => setReferenceActive(kind, item.id, true), "Reference activated.")}>{item.isActive ? "Deactivate" : "Activate"}</button>
                <button type="button" className="btn btn-g set-compact-button" onClick={() => setPending({ type: "merge", item })}>Merge</button>
                {(item.usage?.total ?? 0) === 0 && <button type="button" className="btn btn-g set-compact-button set-danger-action" onClick={() => setPending({ type: "delete", item })}>Delete</button>}
              </div>
            </div>
          ))}
          {displayedItems.length < visibleItems.length && (
            <button type="button" className="btn btn-g set-reference-more" onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visibleItems.length - displayedItems.length)} more
            </button>
          )}
        </div>
      )}
      {pending?.type === "rename" && (
        <ConfirmDialog
          title={`Rename ${kind === "organization" ? "Company" : "Cost centre"}`}
          message={kind === "organization"
            ? <>Rename <strong>{pending.item.name}</strong> to <strong>{pending.nextName}</strong>? Linked licenses, contracts, and procurement records will use the new name, while the company keeps the same identity. Create a new company instead when this is a genuinely different legal entity.</>
            : <>Rename <strong>{pending.item.name}</strong> to <strong>{pending.nextName}</strong>? Linked licenses and viewer access assignments will move with this cost centre.</>}
          confirmLabel="Rename"
          onConfirm={async () => {
            const result = await run(
              () => updateReference(kind, pending.item.id, { name: pending.nextName }),
              `${kind === "organization" ? "Company" : "Cost centre"} renamed.`,
            );
            if (!result?.error) {
              setEditingId(null);
              setEditingName("");
            }
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.type === "deactivate" && (
        <ConfirmDialog
          title={`Deactivate ${kind === "organization" ? "Company" : "Cost centre"}`}
          message={`Deactivate "${pending.item.name}"? Existing links remain intact, but it will no longer be available for new assignments until reactivated.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={() => run(() => setReferenceActive(kind, pending.item.id, false), "Reference deactivated.")}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.type === "delete" && (
        <ConfirmDialog title={`Delete ${kind === "organization" ? "Company" : "Cost centre"}`} message={`Delete "${pending.item.name}"? It is unused and cannot be recovered.`} confirmLabel="Delete" danger onConfirm={() => run(() => deleteReference(kind, pending.item.id), "Reference deleted.")} onCancel={() => setPending(null)} />
      )}
      {pending?.type === "deleteAlias" && (
        <ConfirmDialog title="Remove Alias" message={`Remove alias "${pending.alias.name}" from "${pending.item.name}"?`} confirmLabel="Remove" danger onConfirm={() => run(() => deleteReferenceAlias(kind, pending.item.id, pending.alias.id), "Alias removed.")} onCancel={() => setPending(null)} />
      )}
      {pending?.type === "merge" && (
        <MergeDialog kind={kind} source={mergeSource} onCancel={() => setPending(null)} onError={onError} onConfirm={(targetId) => run(() => mergeReferences(kind, mergeSource.id, targetId), "References merged.")} />
      )}
    </div>
  );
}

function MergeDialog({ kind, source, onCancel, onError, onConfirm }) {
  const [target, setTarget] = useState(null);
  const [targetName, setTargetName] = useState("");
  const [impact, setImpact] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [merging, setMerging] = useState(false);
  const previewRequest = useRef(0);
  const loadImpact = async (nextTarget) => {
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    setTarget(nextTarget);
    setTargetName(nextTarget.name);
    setImpact(null);
    setPreviewError(null);
    setPreviewLoading(true);
    const result = await previewReferenceMerge(kind, source.id, nextTarget.id);
    if (previewRequest.current !== requestId) return;
    setPreviewLoading(false);
    if (result.error) {
      setPreviewError(result.error);
      onError(result.error);
    } else {
      setImpact(result.data);
    }
  };
  const previewIsCurrent = target && impact?.targetId === target.id && !previewLoading && !previewError;
  return (
    <ConfirmDialog
      title={`Merge ${kind === "organization" ? "Company" : "Cost centre"}`}
      message={(
        <div>
          <p>Merge <strong>{source.name}</strong> into the selected canonical reference. {kind === "cost_centre" ? "Viewer access assignments move with the cost centre." : "Linked records, roles, and aliases move to the target."}</p>
          <label className="fg"><span>Canonical target</span>
            <ReferenceCombobox
              mode={kind === "organization" ? "organization" : "costCentre"}
              value={targetName}
              allowCreate={false}
              excludedReferenceIds={[source.id]}
              placeholder="Search active references"
              onChange={(value) => {
                previewRequest.current += 1;
                setTargetName(value);
                setTarget(null);
                setImpact(null);
                setPreviewError(null);
                setPreviewLoading(false);
              }}
              onSelectReference={loadImpact}
            />
          </label>
          {previewLoading && <p className="set-reference-impact">Loading merge impact...</p>}
          {previewError && <p className="set-error-text">Impact preview failed. Select the target again before merging.</p>}
          {previewIsCurrent && <p className="set-reference-impact">This will affect {impact.sourceUsage?.total ?? 0} linked record(s). {kind === "cost_centre" ? "Viewer access assignments are included." : "Roles and non-conflicting aliases will also move."}</p>}
        </div>
      )}
      confirmLabel="Merge"
      danger
      confirmDisabled={!previewIsCurrent || merging}
      onConfirm={async () => {
        if (!previewIsCurrent || merging) return;
        setMerging(true);
        const result = await onConfirm(target.id);
        if (result?.error) setMerging(false);
      }}
      onCancel={onCancel}
    />
  );
}

function CreateReference({ kind, onCreated, onError, onToast }) {
  const [name, setName] = useState("");
  const [isPublisher, setIsPublisher] = useState(false);
  const [isSupplier, setIsSupplier] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim() || (kind === "organization" && !isPublisher && !isSupplier)) return;
    setSaving(true);
    const result = await createReference(kind, kind === "organization" ? { name: name.trim(), isPublisher, isSupplier } : { name: name.trim() });
    setSaving(false);
    if (result.error) onError(result.error);
    else { setName(""); setIsPublisher(false); setIsSupplier(false); onCreated(); onToast(`${kind === "organization" ? "Company" : "Cost centre"} created.`, "info"); }
  };
  return (
    <div className="set-reference-create">
      <div className="fg"><label htmlFor={`new-${kind}-name`}>Add {kind === "organization" ? "company" : "cost centre"}</label><input id={`new-${kind}-name`} className="fi" value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "organization" ? "e.g. Microsoft" : "e.g. Finance"} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /><span className="set-reference-guidance">{kind === "organization" ? "Use Rename when the same legal entity changes its name; add a company only for a distinct entity." : "Renames and merges preserve linked licenses and viewer access assignments."}</span></div>
      {kind === "organization" && <div className="set-reference-role-checks"><label><input type="checkbox" checked={isPublisher} onChange={(event) => setIsPublisher(event.target.checked)} /> Publisher</label><label><input type="checkbox" checked={isSupplier} onChange={(event) => setIsSupplier(event.target.checked)} /> Supplier</label></div>}
      <button type="button" className="btn btn-p set-form-button" disabled={saving || !name.trim() || (kind === "organization" && !isPublisher && !isSupplier)} onClick={submit}>{saving ? "Adding..." : "Add"}</button>
    </div>
  );
}

export default function ReferenceDataSection({ kind, isOpen, isDirty, onToggle, onError, onToast }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);
  const { data = EMPTY, isLoading, error } = useQuery({
    queryKey: queryKeys.referenceDataSearch(kind, debouncedSearch),
    queryFn: async () => {
      const result = await listReferenceData(kind, { search: debouncedSearch });
      if (result.error) throw new Error(result.error);
      return result.data || EMPTY;
    },
    enabled: isOpen,
    staleTime: 0,
  });
  const refresh = () => invalidateReferenceData(queryClient);
  return (
    <div className="setsec">
      <SectionHeader sectionKey={kind === "organization" ? "organizations" : "costCentres"} icon={kind === "organization" ? "building" : "table"} title={kind === "organization" ? "Companies" : "Departments / Cost Centres"} description={kind === "organization" ? "Manage canonical companies, roles, aliases, and duplicate relationships." : "Manage canonical cost centres and preserve viewer access when names change or records merge."} isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
      <div className={`setsec-body${isOpen ? " open" : ""}`}>
        <div className="setsec-inner">
          <CreateReference kind={kind} onCreated={refresh} onError={onError} onToast={onToast} />
          {isLoading ? <p className="set-muted-text">Loading...</p> : error ? <p className="set-error-text">{error.message}</p> : <ReferenceList kind={kind} items={data} search={search} onSearch={setSearch} onError={onError} onToast={onToast} />}
        </div>
      </div>
    </div>
  );
}
