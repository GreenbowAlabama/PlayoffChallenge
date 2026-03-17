import React, { createContext, useContext, useState, useEffect } from 'react';
import { isAuthenticated as checkIsAuthenticated } from './session';

interface AuthContextType {
  isAuthenticated: boolean;
  refreshAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Refresh auth state by checking token validity (includes expiration check)
  const refreshAuth = () => {
    setIsAuthenticated(checkIsAuthenticated());
  };

  // Rehydrate auth state on app load
  useEffect(() => {
    refreshAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
