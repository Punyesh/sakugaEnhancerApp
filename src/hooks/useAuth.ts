import { useState, useEffect, useCallback } from 'react';
import { getStoredCredentials, clearCredentials, StoredCredentials } from '../api/auth';

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
    setCredentials(null);
  }, []);

  return { credentials, setCredentials, logout, loaded };
}
