import { atom } from 'recoil';
import { writeStoredValue } from '@librechat/client';

// Improved helper function to create atoms with localStorage
export function atomWithLocalStorage<T>(key: string, defaultValue: T) {
  return atom<T>({
    key,
    default: defaultValue,
    effects_UNSTABLE: [
      ({ setSelf, onSet }) => {
        const savedValue = localStorage.getItem(key);
        if (savedValue !== null) {
          try {
            const parsedValue = JSON.parse(savedValue);
            setSelf(parsedValue);
          } catch (e) {
            console.error(
              `Error parsing localStorage key "${key}", \`savedValue\`: defaultValue, error:`,
              e,
            );
            writeStoredValue(key, JSON.stringify(defaultValue));
            setSelf(defaultValue);
          }
        }

        onSet((newValue: T) => {
          writeStoredValue(key, JSON.stringify(newValue));
        });
      },
    ],
  });
}
