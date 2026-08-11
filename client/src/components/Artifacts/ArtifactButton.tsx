import { useEffect, useRef } from 'react';
import debounce from 'lodash/debounce';
import { useLocation } from 'react-router-dom';
import { useRecoilState, useSetRecoilState, useResetRecoilState } from 'recoil';
import type { Artifact } from '~/common';
import { cn, logger, isArtifactRoute } from '~/utils';
import { FileCode } from '~/components/icons';
import { useLocalize } from '~/hooks';
import store from '~/store';

const ArtifactButton = ({ artifact }: { artifact: Artifact | null }) => {
  const localize = useLocalize();
  const location = useLocation();
  const setVisible = useSetRecoilState(store.artifactsVisibility);
  const [artifacts, setArtifacts] = useRecoilState(store.artifactsState);
  const [currentArtifactId, setCurrentArtifactId] = useRecoilState(store.currentArtifactId);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);
  const isSelected = artifact?.id === currentArtifactId;
  const [visibleArtifacts, setVisibleArtifacts] = useRecoilState(store.visibleArtifacts);

  const debouncedSetVisibleRef = useRef(
    debounce((artifactToSet: Artifact) => {
      logger.log(
        'artifacts_visibility',
        'Setting artifact to visible state from Artifact button',
        artifactToSet,
      );
      setVisibleArtifacts((prev) => ({
        ...prev,
        [artifactToSet.id]: artifactToSet,
      }));
    }, 750),
  );

  useEffect(() => {
    if (artifact == null || artifact?.id == null || artifact.id === '') {
      return;
    }

    if (!isArtifactRoute(location.pathname)) {
      return;
    }

    const debouncedSetVisible = debouncedSetVisibleRef.current;
    debouncedSetVisible(artifact);
    return () => {
      debouncedSetVisible.cancel();
    };
  }, [artifact, location.pathname]);

  if (artifact === null || artifact === undefined) {
    return null;
  }

  return (
    <div className="group relative my-4 rounded-xl text-sm text-text-primary">
      {(() => {
        const handleClick = () => {
          if (isSelected) {
            resetCurrentArtifactId();
            setVisible(false);
            return;
          }

          setCurrentArtifactId(artifact.id);
          setVisible(true);

          if (artifacts?.[artifact.id] == null) {
            setArtifacts(visibleArtifacts);
          }
        };

        /* The in-chat artifact chip follows the §1.1 selected-state system
           (owner 11.08-4, Kimi as the reference — «тень неуместная»): open =
           card + hairline, closed = flat panel fill that darkens on hover.
           No shadows, no scale — a chip in the text is not a floating card. */
        const buttonClass = cn(
          'relative overflow-hidden rounded-xl border transition-colors duration-90',
          isSelected
            ? 'border-border-light bg-surface-primary'
            : 'border-transparent bg-surface-primary-alt hover:bg-surface-active',
        );

        const actionLabel = isSelected
          ? localize('com_ui_click_to_close')
          : localize('com_ui_artifact_click');

        return (
          <button type="button" onClick={handleClick} className={buttonClass}>
            <div className="w-fit p-2">
              <div className="flex flex-row items-center gap-2">
                <FileCode size={18} className="shrink-0 text-text-tertiary" aria-hidden="true" />
                <div className="overflow-hidden text-left">
                  <div className="truncate text-[13px] font-medium">{artifact.title}</div>
                  <div className="truncate text-[12.5px] leading-4 text-text-tertiary">
                    {actionLabel}
                  </div>
                </div>
              </div>
            </div>
          </button>
        );
      })()}
      <br />
    </div>
  );
};

export default ArtifactButton;
