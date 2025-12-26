import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginWithApple } from '../api/auth';

declare global {
  interface Window {
    AppleID: {
      auth: {
        init: (config: AppleSignInConfig) => void;
        signIn: () => Promise<AppleSignInResponse>;
      };
    };
  }
}

interface AppleSignInConfig {
  clientId: string;
  scope: string;
  redirectURI: string;
  state: string;
  usePopup?: boolean;
}

interface AppleSignInResponse {
  authorization: {
    id_token: string;
  };
}

export function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    script.async = true;
    document.body.appendChild(script);

    script.onload = () => {
      window.AppleID.auth.init({
        clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: window.location.origin,
        state: 'web-admin',
      });

      // Handle redirect callback
      document.addEventListener('AppleIDSignInOnSuccess', async (event: any) => {
        try {
          setLoading(true);
          const idToken = event.detail.authorization.id_token;
          await loginWithApple(idToken);
          navigate('/users');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Authentication failed');
        } finally {
          setLoading(false);
        }
      });

      document.addEventListener('AppleIDSignInOnFailure', (event: any) => {
        setError(event.detail.error || 'Authentication failed');
      });
    };

    return () => {
      document.body.removeChild(script);
      document.removeEventListener('AppleIDSignInOnSuccess', () => {});
      document.removeEventListener('AppleIDSignInOnFailure', () => {});
    };
  }, [navigate]);

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      setError('');
      // In redirect mode, signIn() redirects the page (doesn't return)
      await window.AppleID.auth.signIn();
    } catch (err) {
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
            disabled={loading}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign in with Apple'}
          </button>
        </div>
      </div>
    </div>
  );
}
