import { useState } from 'react';
import type { Models } from 'appwrite';

import { appwriteConfig, hasRequiredCloudConfiguration } from '@/lib/config';
import { register, signIn } from '@/lib/auth';

type AuthScreenProps = {
  appName: string;
  onAuthenticated: (user: Models.User<Models.Preferences>) => void;
};

function formatAuthError(caughtError: unknown) {
  const message = caughtError instanceof Error ? caughtError.message : 'Unable to reach Appwrite.';

  if (/network request failed|failed to fetch/i.test(message)) {
    return `Unable to reach Appwrite at ${appwriteConfig.endpoint}. Restart the app and verify the endpoint is reachable from this machine.`;
  }

  return message;
}

export function AuthScreen({ appName, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });

  const canUseCloud = hasRequiredCloudConfiguration();

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!loginForm.email || !loginForm.password) {
      setError('Enter both your email and password.');
      return;
    }

    setBusy(true);
    try {
      const user = await signIn(loginForm.email.trim(), loginForm.password);
      onAuthenticated(user);
    } catch (caughtError) {
      setError(formatAuthError(caughtError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!registerForm.name || !registerForm.email || !registerForm.password || !registerForm.confirmPassword) {
      setError('Complete every field to create an account.');
      return;
    }

    if (registerForm.password.length < 8) {
      setError('Passwords must be at least 8 characters long.');
      return;
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const user = await register(registerForm.email.trim(), registerForm.password, registerForm.name.trim());
      onAuthenticated(user);
    } catch (caughtError) {
      setError(formatAuthError(caughtError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="brand-mark">
          <span className="brand-dot" />
          <span className="brand-text">{appName}</span>
        </div>
        <div className="auth-copy">
          <p className="eyebrow">Desktop control room</p>
          <h1>Code, flash, and ship OTA firmware with a safer Appwrite workflow.</h1>
          <p>
            Tantalum IDE keeps native device tooling inside Electron, keeps Appwrite auth in the renderer where it belongs,
            and keeps board secrets local to this machine instead of pushing them into your database.
          </p>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'active' : ''} type="button" onClick={() => setMode('signin')}>
            Sign in
          </button>
          <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>
            Create account
          </button>
        </div>

        {!canUseCloud ? (
          <div className="inline-banner inline-banner-warning">
            Appwrite configuration is incomplete. Add the missing values in `appwrite.config.json` or provide renderer env overrides before using authentication or cloud features.
          </div>
        ) : null}

        {error ? <div className="inline-banner inline-banner-error">{error}</div> : null}

        {mode === 'signin' ? (
          <form className="auth-form" onSubmit={handleSignIn}>
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="••••••••"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !canUseCloud}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <label>
              Full name
              <input
                type="text"
                value={registerForm.name}
                onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ada Lovelace"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={registerForm.email}
                onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={registerForm.password}
                onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="At least 8 characters"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={registerForm.confirmPassword}
                onChange={(event) => setRegisterForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                placeholder="Repeat your password"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !canUseCloud}>
              {busy ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
