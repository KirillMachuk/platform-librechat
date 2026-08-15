import { useRecoilCallback } from 'recoil';
import type { TFile } from 'librechat-data-provider';
import { filePreviewArtifact, toolArtifactKey, TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import store from '~/store';

type PreviewFile = Parameters<typeof filePreviewArtifact>[0];
type PreviewMeta = Parameters<typeof filePreviewArtifact>[1];

/**
 * ONE routing decision for opening a stored file (owner 14.08-3): images open
 * the centered lightbox at their call sites; every other file lands in the
 * right artifacts panel through this hook. Registers a thin-pointer
 * FILE_PREVIEW artifact and focuses it.
 *
 * Guard: a tool-produced artifact for the same file shares the same
 * `toolArtifactKey` id and CARRIES content — a citation click for that file
 * must focus it, not overwrite it with an empty pointer.
 */
export default function useOpenFilePreview() {
  return useRecoilCallback(
    ({ snapshot, set }) =>
      (file: PreviewFile & Partial<Pick<TFile, 'type' | 'bytes'>>, meta?: PreviewMeta) => {
        const id = toolArtifactKey(file);
        const existing = snapshot.getLoadable(store.artifactsState).valueMaybe()?.[id];
        if (existing == null || existing.type === TOOL_ARTIFACT_TYPES.FILE_PREVIEW) {
          set(store.artifactsState, (prev) => ({
            ...(prev ?? {}),
            [id]: filePreviewArtifact(file, meta),
          }));
        }
        set(store.currentArtifactId, id);
        set(store.artifactsVisibility, true);
      },
    [],
  );
}
