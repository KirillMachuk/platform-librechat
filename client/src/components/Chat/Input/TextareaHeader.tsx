import { memo } from 'react';
import type { TConversation } from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import AddedConvo from './AddedConvo';

export default memo(function TextareaHeader({
  addedConvo,
  setAddedConvo,
}: {
  addedConvo: TConversation | null;
  setAddedConvo: SetterOrUpdater<TConversation | null>;
}) {
  if (!addedConvo) {
    return null;
  }
  return (
    /* One radius rather than 16 on top and 8 below, and the passive surface: the
       strip used to sit on `secondary-alt`, which is the pressed/selected shade
       (#E8E8E8) and read as if the row were active. */
    <div className="m-1.5 flex flex-col divide-y overflow-hidden rounded-2xl bg-surface-secondary">
      <AddedConvo addedConvo={addedConvo} setAddedConvo={setAddedConvo} />
    </div>
  );
});
