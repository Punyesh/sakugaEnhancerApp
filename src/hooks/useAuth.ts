import { useState, useEffect, useCallback } from 'react';
import { getStoredCredentials, clearCredentials, StoredCredentials } from '../api/auth';
import { setSessionEstablished } from '../api/sessionState';

export function useAuth() {
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getStoredCredentials().then((c) => {
      setCredentials(c);
      setLoaded(true);
    });
  }, []);

  const logout = useCallback(async () => {
    await clearCredentials();
    await setSessionEstablished(false); // don't let a stale flag from a previous login linger
    setCredentials(null);
  }, []);

  return { credentials, setCredentials, logout, loaded };
}
