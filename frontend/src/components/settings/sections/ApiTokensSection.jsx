import { useEffect, useState } from "react";
import { createApiToken, listApiTokens, revokeApiToken } from "../../../api/settings.js";
import { formatDateTime } from "../../../utils/formatting.js";
import Icon from "../../ui/Icon.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { SectionHeader } from "../SectionShared.jsx";

const API_TOKEN_SCOPES = [
  ["licenses:read", "Read licenses"],
  ["licenses:write", "Write licenses"],
  ["procurement:read", "Read procurement"],
  ["procurement:write", "Write procurement"],
  ["documents:read", "Read documents"],
  ["documents:write", "Write documents"],
  ["reports:read", "Read reports"],
  ["extensions:read", "Read extensions"],
  ["extensions:write", "Write extensions"],
];

function normalizeToken(token) {
  return {
    ...token,
    tokenPrefix: token.tokenPrefix ?? token.token_prefix,
    createdAt: token.createdAt ?? token.created_at,
    lastUsedAt: token.lastUsedAt ?? token.last_used_at,
    revokedAt: token.revokedAt ?? token.revoked_at,
  };
}

export default function ApiTokensSection({ isOpen, isDirty, onToggle, onError, onToast, userSettings }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateToken, setShowCreateToken] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["licenses:read"]);
  const [createdToken, setCreatedToken] = useState(null);
  const [revokePending, setRevokePending] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    listApiTokens().then(({ data, error }) => {
      setLoading(false);
      if (error) { onError(error); return; }
      setTokens((data ?? []).map(normalizeToken));
    });
  }, [isOpen, onError]);

  const toggleScope = (scope) => {
    setScopes((current) => (
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope].sort()
    ));
  };

  const handleCreate = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    const { data, error } = await createApiToken({ name: name.trim(), scopes });
    setCreating(false);
    if (error) { onError(error); return; }
    const token = normalizeToken(data);
    setTokens((current) => [token, ...current]);
    setCreatedToken(token);
    setName("");
    setScopes(["licenses:read"]);
    setShowCreateToken(false);
    onToast("API token created.", "info");
  };

  const handleRevoke = async () => {
    if (!revokePending) return;
    const { error } = await revokeApiToken(revokePending.id);
    if (error) { onError(error); setRevokePending(null); return; }
    const revokedAt = new Date().toISOString();
    setTokens((current) => current.map((token) => (
      token.id === revokePending.id ? { ...token, revokedAt } : token
    )));
    onToast(`API token "${revokePending.name}" revoked.`, "info");
    setRevokePending(null);
  };

  const copyCreatedToken = async () => {
    if (!createdToken?.token) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      onToast("Token copied.", "info");
    } catch {
      onError("Could not copy token to clipboard.");
    }
  };

  return (
    <>
      <div className="setsec">
        <SectionHeader sectionKey="apiTokens" icon="key" title="API Tokens" description="Create scoped bearer tokens for integrations and automation." isOpen={isOpen} isDirty={isDirty} onToggle={onToggle} />
        <div className={`setsec-body${isOpen ? " open" : ""}`}>
          <div className="setsec-inner">
            {createdToken && (
              <div className="set-token-panel">
                <div className="set-token-panel-header">
                  <strong className="set-token-title">New token for {createdToken.name}</strong>
                  <button type="button" className="btn btn-g set-token-dismiss" onClick={() => setCreatedToken(null)}>
                    <Icon name="x" size={12} /> Dismiss
                  </button>
                </div>
                <p className="set-token-panel-note">
                  Copy and save this token now. It cannot be recovered after you dismiss it.
                </p>
                <div className="set-token-copy-row">
                  <input className="fi mono set-token-input" readOnly value={createdToken.token} />
                  <button type="button" className="btn btn-p set-token-copy-button" onClick={copyCreatedToken}>
                    Copy
                  </button>
                </div>
              </div>
            )}

            <div className="set-section-stack">
              {loading ? (
                <p className="set-muted-text">Loading...</p>
              ) : tokens.length === 0 ? (
                <p className="set-muted-text set-token-empty">No API tokens yet.</p>
              ) : (
                <table className="mapping-matched-table set-token-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Prefix</th>
                      <th scope="col">Scopes</th>
                      <th scope="col">Last Used</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => (
                      <tr key={token.id} className={token.revokedAt ? "set-token-row-revoked" : undefined}>
                        <td><span className="set-token-name">{token.name}</span></td>
                        <td><span className="mono set-token-prefix">{token.tokenPrefix}</span></td>
                        <td><span className="set-token-cell-text">{(token.scopes ?? []).join(", ")}</span></td>
                        <td><span className="set-token-cell-text">{token.revokedAt ? "Revoked" : (formatDateTime(token.lastUsedAt, userSettings) || "Never")}</span></td>
                        <td>
                          <button type="button" className="btn btn-g set-token-revoke" disabled={!!token.revokedAt} onClick={() => setRevokePending(token)}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {showCreateToken ? (
                <div className="set-token-form">
                  <div className="fg set-token-name-field">
                    <label htmlFor="api-token-name">Name</label>
                    <input id="api-token-name" className="fi" value={name} onChange={(event) => setName(event.target.value)} placeholder="CMDB sync" onKeyDown={(event) => { if (event.key === "Enter") handleCreate(); }} autoFocus />
                  </div>
                  <div className="fg">
                    <label>Scopes</label>
                    <div className="set-token-scopes">
                      {API_TOKEN_SCOPES.map(([scope, label]) => (
                        <label key={scope} className={`set-token-scope${scopes.includes(scope) ? " selected" : ""}`}>
                          <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="set-token-actions">
                    <button type="button" className="btn btn-p set-token-form-button" disabled={creating || !name.trim() || scopes.length === 0} onClick={handleCreate}>
                      {creating ? "Creating..." : "Create"}
                    </button>
                    <button type="button" className="btn btn-g set-token-form-button" onClick={() => { setShowCreateToken(false); setName(""); setScopes(["licenses:read"]); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-g set-token-create-button" onClick={() => setShowCreateToken(true)}>
                  <Icon name="plus" size={13} /> Create Token
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {revokePending && (
        <ConfirmDialog title="Revoke API Token" message={`Revoke "${revokePending.name}"? Existing integrations using it will stop working immediately.`} confirmLabel="Revoke" danger onConfirm={handleRevoke} onCancel={() => setRevokePending(null)} />
      )}
    </>
  );
}
