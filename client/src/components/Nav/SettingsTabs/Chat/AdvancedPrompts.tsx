import { useCallback, useId } from 'react';
import { Switch, SettingRow } from '@librechat/client';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { PromptsEditorMode } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';

const { promptsEditorMode, alwaysMakeProd } = store;

export default function AdvancedPrompts() {
  const localize = useLocalize();
  const [mode, setMode] = useRecoilState(promptsEditorMode);
  const setAlwaysMakeProd = useSetRecoilState(alwaysMakeProd);

  const isAdvanced = mode === PromptsEditorMode.ADVANCED;

  const handleChange = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setAlwaysMakeProd(true);
      }
      setMode(checked ? PromptsEditorMode.ADVANCED : PromptsEditorMode.SIMPLE);
    },
    [setMode, setAlwaysMakeProd],
  );

  const rootId = useId();

  return (
    <SettingRow
      id={rootId}
      title={localize('com_nav_advanced_prompts')}
      description={localize('com_nav_advanced_prompts_desc')}
      control={({ labelId, descriptionId }) => (
        <Switch
          size="row"
          id={rootId}
          checked={isAdvanced}
          onCheckedChange={handleChange}
          data-testid="advancedPrompts"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
        />
      )}
    />
  );
}
