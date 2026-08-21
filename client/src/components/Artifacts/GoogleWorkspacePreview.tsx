import type { Artifact } from '~/common';
import { getGoogleWorkspaceEmbedUrl, validateGoogleWorkspaceFile } from '~/utils/google';
import { useLocalize } from '~/hooks';

const GOOGLE_IFRAME_SANDBOX =
  'allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts';

export default function GoogleWorkspacePreview({
  artifact,
  isMobile,
}: {
  artifact: Artifact;
  isMobile: boolean;
}) {
  const localize = useLocalize();
  const file = artifact.googleWorkspace;
  const parsed = validateGoogleWorkspaceFile(file);

  if (!file || !parsed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary">
        {localize('com_ui_google_workspace_preview_unavailable')}
      </div>
    );
  }

  return (
    <iframe
      title={file.name}
      src={getGoogleWorkspaceEmbedUrl(parsed, isMobile)}
      sandbox={GOOGLE_IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-white"
    />
  );
}
