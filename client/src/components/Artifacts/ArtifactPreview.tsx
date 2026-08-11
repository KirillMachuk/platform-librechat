import React, { memo, useMemo, type MutableRefObject } from 'react';
import { SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react/unstyled';
import type {
  SandpackProviderProps,
  SandpackPreviewRef,
} from '@codesandbox/sandpack-react/unstyled';
import type { TStartupConfig } from 'librechat-data-provider';
import type { ArtifactFiles } from '~/common';
import { sharedFiles, buildSandpackOptions } from '~/utils/artifacts';
import StaticPreview from './StaticPreview';

export const ArtifactPreview = memo(function ({
  files,
  fileKey,
  template,
  sharedProps,
  previewRef,
  currentCode,
  startupConfig,
}: {
  files: ArtifactFiles;
  fileKey: string;
  template: SandpackProviderProps['template'];
  sharedProps: Partial<SandpackProviderProps>;
  previewRef: MutableRefObject<SandpackPreviewRef>;
  currentCode?: string;
  startupConfig?: TStartupConfig;
}) {
  const artifactFiles = useMemo(() => {
    if (Object.keys(files).length === 0) {
      return files;
    }
    const code = currentCode ?? '';
    if (!code) {
      return files;
    }
    return {
      ...files,
      [fileKey]: { code },
    };
  }, [currentCode, files, fileKey]);

  const options: SandpackProviderProps['options'] = useMemo(
    () => buildSandpackOptions(template, startupConfig),
    [startupConfig, template],
  );

  /* The `static` bucket — HTML, markdown, code and every office preview —
     always resolves to a finished `index.html` (useArtifactProps), so it needs
     no bundler at all. It renders in our own sandboxed iframe instead of a
     third party's; see StaticPreview for why that matters here. */
  const staticHtml = useMemo(() => {
    if (template !== 'static') {
      return undefined;
    }
    /* The live-editing path above replaces the edited file with `{ code }`;
       every other entry is the string itself. */
    const entry = (artifactFiles as Record<string, unknown>)['index.html'];
    if (typeof entry === 'string') {
      return entry;
    }
    if (entry !== null && typeof entry === 'object' && 'code' in entry) {
      const { code } = entry as { code?: unknown };
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }, [artifactFiles, template]);

  if (Object.keys(artifactFiles).length === 0) {
    return null;
  }

  if (staticHtml !== undefined) {
    return <StaticPreview html={staticHtml} title={fileKey} />;
  }

  return (
    <SandpackProvider
      files={{ ...artifactFiles, ...sharedFiles }}
      options={options}
      {...sharedProps}
      template={template}
    >
      <SandpackPreview
        showOpenInCodeSandbox={false}
        showRefreshButton={false}
        tabIndex={0}
        ref={previewRef}
      />
    </SandpackProvider>
  );
});
