import { useState } from 'react';
import { OGDialogTemplate, OGDialog, OGDialogTrigger, Button } from '@librechat/client';
import ArchivedChatsTable from './ArchivedChatsTable';
import { useLocalize } from '~/hooks';

export default function ArchivedChats() {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex items-center justify-between">
      <div>{localize('com_nav_archived_chats')}</div>
      <OGDialog open={isOpen} onOpenChange={setIsOpen}>
        <OGDialogTrigger asChild>
          {/* The visible label is just "Manage", which says nothing on its own to a
              screen reader — hence a name of its own, from the same key as the row. */}
          <Button variant="outline" aria-label={localize('com_nav_archived_chats')}>
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
    </div>
  );
}
