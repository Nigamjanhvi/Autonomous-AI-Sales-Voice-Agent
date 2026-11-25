/** Single trusted workspace for this local MVP. Never read this from request data. */
export const DEFAULT_WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID?.trim() || "workspace_default";
export function currentWorkspaceId() { return DEFAULT_WORKSPACE_ID; }
