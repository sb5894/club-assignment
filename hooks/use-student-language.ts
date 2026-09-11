'use client';

import { useSyncExternalStore } from 'react';
import type { StudentLanguage } from '@/lib/student-clubs';

const storageKey = 'student-language';
const changeEvent = 'student-language-change';
let currentLanguage: StudentLanguage | undefined;

function snapshot(): StudentLanguage {
  if (currentLanguage) return currentLanguage;
  try {
    return localStorage.getItem(storageKey) === 'ru' ? 'ru' : 'ko';
  } catch {
    return 'ko';
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      currentLanguage = undefined;
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

function changeLanguage(next: StudentLanguage) {
  currentLanguage = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    /* Switching also works without storage. */
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useStudentLanguage() {
  const language = useSyncExternalStore(
    subscribe,
    snapshot,
    (): StudentLanguage => 'ko',
  );
  return [language, changeLanguage] as const;
}
