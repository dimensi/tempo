'use client';
import { useEffect, useState } from 'react';
export function notifyAnamnesisChanged() {
  window.dispatchEvent(new Event('anamnesis-changed'));
}
export function useAnamnesisRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('anamnesis-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('anamnesis-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return revision;
}
