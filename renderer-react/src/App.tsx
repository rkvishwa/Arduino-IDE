import { useEffect, useState } from 'react';
import type { Models } from 'appwrite';

import { getCurrentUser } from '@/lib/auth';

import { AuthScreen } from './components/AuthScreen';
import { IDEWorkspace } from './components/IDEWorkspace';

type AppInfo = {
  appName: string;
  version: string;
};

function App() {
  const [user, setUser] = useState<Models.User<Models.Preferences> | null | undefined>(undefined);
  const [appInfo, setAppInfo] = useState<AppInfo>({ appName: 'Tantalum IDE', version: '1.0.0' });

  useEffect(() => {
    let mounted = true;

    void window.tantalum.app.getInfo().then((result) => {
      if (mounted && result.success) {
        setAppInfo({ appName: result.appName, version: result.version });
      }
    });

    void getCurrentUser().then((resolvedUser) => {
      if (mounted) {
        setUser(resolvedUser);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (user === undefined) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <p className="eyebrow">Booting</p>
          <h1>{appInfo.appName}</h1>
          <p>Loading your local workspace, Appwrite session, and desktop toolchain.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen appName={appInfo.appName} onAuthenticated={setUser} />;
  }

  return <IDEWorkspace appName={appInfo.appName} version={appInfo.version} user={user} onSignedOut={() => setUser(null)} />;
}

export default App;
