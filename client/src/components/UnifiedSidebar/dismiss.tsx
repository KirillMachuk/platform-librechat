import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const PanelDismissContext = createContext<(() => void) | null>(null);

/**
 * Panels open inside a modal that outlives navigation, so content that routes the
 * app elsewhere has to dismiss it explicitly or the destination opens underneath.
 * Returns a no-op outside a panel (the same components also render as full pages).
 */
export function usePanelDismiss(): () => void {
  const dismiss = useContext(PanelDismissContext);
  return dismiss ?? noop;
}

const noop = () => undefined;

export function PanelDismissProvider({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: ReactNode;
}) {
  return <PanelDismissContext.Provider value={onDismiss}>{children}</PanelDismissContext.Provider>;
}
