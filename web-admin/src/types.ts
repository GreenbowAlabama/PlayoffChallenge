export interface User {
  id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  paid: boolean;
  is_admin: boolean;
  apple_id: string | null;
  created_at: string | null;
}

export interface AuthResponse {
  token: string;
}

export interface AppleAuthRequest {
  id_token: string;
}
