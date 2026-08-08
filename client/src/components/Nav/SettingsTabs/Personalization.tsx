import { useState, useEffect } from 'react';
import {
  Switch,
  SettingRow,
  SettingGroup,
  useToastContext,
  SETTINGS_TAB_BODY,
} from '@librechat/client';
import { useGetUserQuery, useUpdateMemoryPreferencesMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

interface PersonalizationProps {
  hasMemoryOptOut: boolean;
  hasAnyPersonalizationFeature: boolean;
}

export default function Personalization({
  hasMemoryOptOut,
  hasAnyPersonalizationFeature,
}: PersonalizationProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);

  const updateMemoryPreferencesMutation = useUpdateMemoryPreferencesMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      // Revert the toggle on error
      setReferenceSavedMemories((prev) => !prev);
    },
  });

  // Initialize state from user data
  useEffect(() => {
    if (user?.personalization?.memories !== undefined) {
      setReferenceSavedMemories(user.personalization.memories);
    }
  }, [user?.personalization?.memories]);

  const handleMemoryToggle = (checked: boolean) => {
    setReferenceSavedMemories(checked);
    updateMemoryPreferencesMutation.mutate({ memories: checked });
  };

  if (!hasAnyPersonalizationFeature) {
    return (
      <div className={SETTINGS_TAB_BODY}>
        <div className="text-text-secondary">{localize('com_ui_no_personalization_available')}</div>
      </div>
    );
  }

  return (
    <div className={SETTINGS_TAB_BODY}>
      {hasMemoryOptOut && (
        <SettingGroup label={localize('com_ui_memory')}>
          <SettingRow
            id="reference-saved-memories"
            title={localize('com_ui_reference_saved_memories')}
            description={localize('com_ui_reference_saved_memories_description')}
            control={({ labelId, descriptionId }) => (
              <Switch
                size="row"
                checked={referenceSavedMemories}
                onCheckedChange={handleMemoryToggle}
                disabled={updateMemoryPreferencesMutation.isLoading}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
              />
            )}
          />
        </SettingGroup>
      )}
    </div>
  );
}
