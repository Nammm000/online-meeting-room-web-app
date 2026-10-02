/** User.Role enum on the backend; also the JWT `role` claim value. */
export type Role = 'ROLE_USER' | 'ROLE_ADMIN' | 'ROLE_CUSTOMER';

/** Nested AccountLevel entity, serialized whole by the backend. */
export interface AccountLevel {
  id: number;
  code: string;
  name: string;
  description?: string | null;
}

/**
 * GET /users item (UserWrapper). `status` is a stringly-typed "true"/"false"
 * on the backend. `accountLevel`/`accountNumber` are only sent by
 * GET /users/current-user (the admin list endpoint omits them), so both are
 * optional and nullable here.
 */
export interface UserWrapper {
  id: number;
  name: string;
  email: string;
  phone: string;
  status: string;
  createdTime: string;
  role: Role;
  accountLevel?: AccountLevel | null;
  accountNumber?: string | null;
}

/** PATCH /users/{id}/role body. */
export interface UpdateUserRoleRequest {
  role: Role;
}
