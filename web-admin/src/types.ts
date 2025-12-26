export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  is_paid: boolean;
}

export interface AuthResponse {
  token: string;
}

export interface AppleAuthRequest {
  id_token: string;
}
