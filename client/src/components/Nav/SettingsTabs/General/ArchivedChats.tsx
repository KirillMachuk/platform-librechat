import { useState } from 'react';
import { OGDialogTemplate, OGDialog, OGDialogTrigger, Button, SettingRow } from '@librechat/client';
import ArchivedChatsTable from './ArchivedChatsTable';
import { useLocalize } from '~/hooks';

export default function ArchivedChats() {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SettingRow
      id="archived-chats"
      title={localize('com_nav_archived_chats')}
      description={localize('com_nav_archived_chats_desc')}
      stackControlOnMobile
      control={({ labelId }) => (
        <OGDialog open={isOpen} onOpenChange={setIsOpen}>
          <OGDialogTrigger asChild>
            {/* The visible label is just "Manage", which says nothing on its own to a
                screen reader — hence a name of its own, from the same key as the row. */}
            <Button variant="outline" aria-labelledby={labelId}>
              {localize('com_ui_manage')}
            </Button>
          </OGDialogTrigger>
          <OGDialogTemplate
            title={localize('com_nav_archived_chats')}
            className="max-w-[1000px]"
            showCancelButton={false}
            main={<ArchivedChatsTable onOpenChange={setIsOpen} />}
          />
        </OGDialog>
      )}
    />
  );
}
