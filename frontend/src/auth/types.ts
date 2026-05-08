/**
 * Authenticated user shape exposed to React. Matches the `User` schema in
 * `docs/api-contracts/openapi.yaml`.
 */
export interface AuthUser {
  id: string;
  email: string;
  timezone: string;
  dailyCapEur: number;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
