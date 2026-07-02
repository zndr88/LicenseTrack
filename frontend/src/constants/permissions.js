export const ROLE_PERMISSIONS = {
  admin:  { canEdit: true,  canDelete: true,  canUpload: true,  canManageUsers: true,  canSettings: true, canAdminSettings: true,  canExport: true },
  editor: { canEdit: true,  canDelete: true,  canUpload: true,  canManageUsers: false, canSettings: true, canAdminSettings: false, canExport: true },
  viewer: { canEdit: false, canDelete: false, canUpload: false, canManageUsers: false, canSettings: true, canAdminSettings: false, canExport: true },
};

export const ROLE_LABELS = { admin: "Administrator", editor: "Editor", viewer: "Viewer" };
