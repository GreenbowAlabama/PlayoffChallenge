import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { setToken } from '../auth/session';

declare global {
  interface Window {
    AppleID: {
      auth: {
        init: (config: AppleSignInConfig) => void;
        signIn: () => Promise<void>;
      };
    };
  }
}

interface AppleSignInConfig {
  clientId: string;
  scope: string;
  redirectURI: string;
  responseType: string;
  state: string;
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [appleAuthReady, setAppleAuthReady] = useState(false);
  const { refreshAuth } = useAuth();

  // Check for token in URL (from backend redirect after Apple auth)
  useEffect(() => {
    console.log('[Login] useEffect triggered');
    console.log('[Login] Current URL:', window.location.href);
    console.log('[Login] searchParams keys:', Array.from(searchParams.keys()));

    const token = searchParams.get('token');
    console.log('[Login] Token from searchParams:', token ? `present (${token.substring(0, 20)}...)` : 'missing');

    if (token) {
      try {
        console.log('[Login] Storing token via setToken()');
        setToken(token);
        console.log('[Login] Token stored successfully');

        // Update AuthContext state after storing token
        console.log('[Login] Calling refreshAuth() to update context state');
        refreshAuth();

        // Micro delay before navigate for strict mode compatibility
        console.log('[Login] Calling navigate(/admin, { replace: true })');
        setTimeout(() => navigate('/admin', { replace: true }), 0);
        console.log('[Login] Navigate scheduled');
      } catch (err) {
        console.error('[Login] Error in token handling:', err);
      }
      return;
    }

    console.log('[Login] No token found in URL');
  }, [searchParams, navigate, refreshAuth]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    script.async = true;
    document.body.appendChild(script);

    script.onload = () => {
      window.AppleID.auth.init({
        clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI,
        responseType: 'code',
        state: 'web-admin',
      });
      setAppleAuthReady(true);
    };

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handleAppleSignIn = async () => {
    console.log('[Login] Apple sign in clicked, appleAuthReady:', appleAuthReady);

    if (!appleAuthReady) {
      console.error('[Login] Apple auth not ready');
      setError('Apple auth is loading. Please wait...');
      return;
    }
    try {
      setLoading(true);
      setError('');
      console.log('[Login] Calling window.AppleID.auth.signIn()');
      await window.AppleID.auth.signIn();
      console.log('[Login] Apple sign in completed');
    } catch (err) {
      console.error('[Login] Apple sign in error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Playoff Challenge Admin
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to access the admin panel
          </p>
        </div>

        <div className="mt-8 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            onClick={handleAppleSignIn}
            disabled={loading || !appleAuthReady}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : appleAuthReady ? 'Sign in with Apple' : 'Loading...'}
          </button>
        </div>
      </div>
    </div>
  );
}
