/**
 * User management API - admin user CRUD, role/password changes, and department
 * scope assignment.
 *
 * Endpoints:
 *   GET    /api/users                     - list users
 *   POST   /api/users                     - create user
 *   PUT    /api/users/{id}                - update user profile/provider/role
 *   PUT    /api/users/{id}/role           - legacy role-only update
 *   PUT    /api/users/{id}/reset-password - force password reset
 *   DELETE /api/users/{id}                - delete user
 *   GET    /api/licenses/departments      - list assignable departments
 *   GET    /api/users/{id}/departments    - list user department assignments
 *   PUT    /api/users/{id}/departments    - replace department assignments
 */

import { del, get, post, put } from "./client.js";

/**
 * List all users in the system (admin only).
 *
 * @returns {Promise<{ data: object[] | null, error: string | null }>}
 */
export async function getUsers() {
  return get("/api/users");
}

/**
 * Create a new user (admin only).
 *
 * @param {{ username: string, email: string, password?: string, role: string, auth_provider: string }} userData
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function createUser(userData) {
  return post("/api/users", userData);
}

/**
 * Update a user (admin only).
 *
 * @param {number} userId
 * @param {object} userData
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function updateUser(userId, userData) {
  return put(`/api/users/${userId}`, userData);
}

/**
 * Change the role of an existing user (admin only).
 *
 * @param {number} userId
 * @param {string} role — "admin" | "editor" | "viewer"
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function updateRole(userId, role) {
  return put(`/api/users/${userId}/role`, { role });
}

/**
 * Delete a user (admin only).
 *
 * @param {number} userId
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function deleteUser(userId) {
  return del(`/api/users/${userId}`);
}

/**
 * Force-reset another user's password (admin only).
 * User will be flagged must_change_password on next login.
 *
 * @param {number} userId
 * @param {string} newPassword
 * @returns {Promise<{ data: null, error: string | null }>}
 */
export async function resetUserPassword(userId, newPassword) {
  return put(`/api/users/${userId}/reset-password`, { new_password: newPassword });
}

/**
 * Fetch distinct department values available for assignment.
 * @returns {Promise<{ data: string[] | null, error: string | null }>}
 */
export async function getDepartments() {
  return get("/api/licenses/departments");
}

/**
 * Fetch the current department assignments for a user (admin only).
 * @param {number} userId
 * @returns {Promise<{ data: string[] | null, error: string | null }>}
 */
export async function getUserDepartments(userId) {
  return get(`/api/users/${userId}/departments`);
}

/**
 * Replace all department assignments for a user (admin only).
 * @param {number} userId
 * @param {string[]} departments
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function updateUserDepartments(userId, departments) {
  return put(`/api/users/${userId}/departments`, { departments });
}
