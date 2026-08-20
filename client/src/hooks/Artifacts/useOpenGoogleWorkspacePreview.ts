import { useRecoilCallback } from 'recoil';
import { googleWorkspaceArtifact } from '~/utils/artifacts';
import { parseGoogleWorkspaceUrl } from '~/utils/google';
import store from '~/store';

/**
 * Opens a strictly validated Google Workspace or Drive file URL in the artifacts panel.
 * Returning false lets callers fall back to ordinary external navigation.
 */
export default function useOpenGoogleWorkspacePreview() {
  return useRecoilCallback(
    ({ set }) =>
      (rawUrl: string, name: string): boolean => {
        const parsed = parseGoogleWorkspaceUrl(rawUrl);
        if (!parsed) {
          return false;
        }

        const artifact = googleWorkspaceArtifact({
          ...parsed,
          provider: 'google_drive',
          name,
        });

        set(store.artifactsState, (previous) => ({
          ...(previous ?? {}),
          [artifact.id]: artifact,
        }));
        set(store.currentArtifactId, artifact.id);
        set(store.artifactsVisibility, true);
        return true;
      },
    [],
  );
}
