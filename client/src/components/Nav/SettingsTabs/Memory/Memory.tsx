import { memo } from 'react';
import { MemoryPanel } from '~/components/SidePanel/Memories';

function Memory() {
  return (
    <div className="flex flex-col gap-3 text-sm text-text-primary">
      <MemoryPanel />
    </div>
  );
}

export default memo(Memory);
