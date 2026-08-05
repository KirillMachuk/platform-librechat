import { useRecoilValue } from 'recoil';
import store from '~/store';

/**
 * Whether the right-hand artifacts panel is actually on screen.
 *
 * Two places need the same answer and must not drift apart: the chat decides
 * whether to render the panel at all, and the frame decides whether the working
 * area is one card or two (canon §4 — the panel is a card of its own, and the
 * gap between the cards is the drag handle).
 *
 * `currentArtifactId` gates it in addition to visibility and a non-empty map:
 * navigating to an old conversation full of artifacts resets the focus, and the
 * panel must stay closed until something is actually focused.
 */
export default function useArtifactsPanelOpen(): boolean {
  const artifacts = useRecoilValue(store.artifactsState);
  const artifactsVisibility = useRecoilValue(store.artifactsVisibility);
  const currentArtifactId = useRecoilValue(store.currentArtifactId);

  return (
    artifactsVisibility === true &&
    currentArtifactId != null &&
    Object.keys(artifacts ?? {}).length > 0
  );
}
