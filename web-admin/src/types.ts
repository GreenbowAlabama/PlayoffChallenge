export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  paid: boolean;
}

export interface AuthResponse {
  token: string;
}

export interface AppleAuthRequest {
  id_token: string;
}
