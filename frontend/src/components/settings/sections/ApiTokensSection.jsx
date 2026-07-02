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
              <div style={{ border: "1px solid var(--border)", background: "var(--bg-2)", borderRadius: 6, padding: 12, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>New token for {createdToken.name}</strong>
                  <button type="button" className="btn btn-g" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setCreatedToken(null)}>
                    <Icon name="x" size={12} /> Dismiss
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-2)", margin: "0 0 8px" }}>
                  Copy and save this token now. It cannot be recovered after you dismiss it.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input className="fi mono" readOnly value={createdToken.token} style={{ fontSize: 12 }} />
                  <button type="button" className="btn btn-p" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={copyCreatedToken}>
                    Copy
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              {loading ? (
                <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 8 }}>Loading...</p>
              ) : tokens.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 8, marginBottom: 12 }}>No API tokens yet.</p>
              ) : (
                <table className="mapping-matched-table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Name</th>
                      <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Prefix</th>
                      <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Scopes</th>
                      <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Last Used</th>
                      <th scope="col" style={{ color: "var(--text-3)", fontWeight: 600, paddingBottom: 6, textAlign: "left" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => (
                      <tr key={token.id} style={{ opacity: token.revokedAt ? 0.55 : 1 }}>
                        <td><span style={{ fontSize: 13, fontWeight: 600 }}>{token.name}</span></td>
                        <td><span className="mono" style={{ fontSize: 11 }}>{token.tokenPrefix}</span></td>
                        <td><span style={{ fontSize: 12 }}>{(token.scopes ?? []).join(", ")}</span></td>
                        <td><span style={{ fontSize: 12 }}>{token.revokedAt ? "Revoked" : (formatDateTime(token.lastUsedAt, userSettings) || "Never")}</span></td>
                        <td>
                          <button type="button" className="btn btn-g" disabled={!!token.revokedAt} style={{ fontSize: 11, padding: "2px 8px", color: token.revokedAt ? "var(--text-3)" : "var(--red-text)" }} onClick={() => setRevokePending(token)}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {showCreateToken ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                  <div className="fg" style={{ maxWidth: 320 }}>
                    <label htmlFor="api-token-name">Name</label>
                    <input id="api-token-name" className="fi" value={name} onChange={(event) => setName(event.target.value)} placeholder="CMDB sync" onKeyDown={(event) => { if (event.key === "Enter") handleCreate(); }} autoFocus />
                  </div>
                  <div className="fg">
                    <label>Scopes</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {API_TOKEN_SCOPES.map(([scope, label]) => (
                        <label key={scope} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", borderColor: scopes.includes(scope) ? "var(--accent)" : "var(--border)", borderRadius: 4, background: "var(--bg-2)", color: "var(--text-2)", fontSize: 11, lineHeight: 1.2, padding: "4px 8px", cursor: "pointer" }}>
                          <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn-p" disabled={creating || !name.trim() || scopes.length === 0} onClick={handleCreate} style={{ fontSize: 13 }}>
                      {creating ? "Creating..." : "Create"}
                    </button>
                    <button type="button" className="btn btn-g" onClick={() => { setShowCreateToken(false); setName(""); setScopes(["licenses:read"]); }} style={{ fontSize: 13 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-g" onClick={() => setShowCreateToken(true)} style={{ fontSize: 13, marginTop: 12 }}>
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
