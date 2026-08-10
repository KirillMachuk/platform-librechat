import React, { useState } from 'react';
import { useClearConversationsMutation } from 'librechat-data-provider/react-query';
import {
  OGDialogTemplate,
  SettingRow,
  Label,
  Button,
  OGDialog,
  OGDialogTrigger,
  Spinner,
} from '@librechat/client';
import { clearAllConversationStorage } from '~/utils';
import { useLocalize, useNewConvo } from '~/hooks';

export const ClearChats = () => {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const { newConversation } = useNewConvo();
  const clearConvosMutation = useClearConversationsMutation();

  const clearConvos = () => {
    clearConvosMutation.mutate(
      {},
      {
        onSuccess: () => {
          clearAllConversationStorage();
          newConversation();
        },
      },
    );
  };

  return (
    <SettingRow
      id="clear-all-chats"
      title={localize('com_nav_clear_all_chats')}
      description={localize('com_nav_clear_all_chats_desc')}
      stackControlOnMobile
      control={({ labelId, descriptionId }) => (
        <OGDialog open={open} onOpenChange={setOpen}>
          <OGDialogTrigger asChild>
            <Button
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              variant="destructive"
              onClick={() => setOpen(true)}
            >
              {localize('com_ui_delete')}
            </Button>
          </OGDialogTrigger>
          <OGDialogTemplate
            showCloseButton={false}
            title={localize('com_nav_confirm_clear')}
            className="max-w-[450px]"
            main={
              <Label className="break-words">
                {localize('com_nav_clear_conversation_confirm_message')}
              </Label>
            }
            selection={{
              selectHandler: clearConvos,
              selectClasses:
                'bg-destructive text-white transition-all duration-200 hover:bg-destructive/80',
              selectText: clearConvosMutation.isLoading ? <Spinner /> : localize('com_ui_delete'),
            }}
          />
        </OGDialog>
      )}
    />
  );
};
