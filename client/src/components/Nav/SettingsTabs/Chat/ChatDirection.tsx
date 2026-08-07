import React from 'react';
import { useRecoilState } from 'recoil';
import { Button, SettingRow } from '@librechat/client';
import { useLocalize } from '~/hooks';
import store from '~/store';

const ChatDirection = () => {
  const [direction, setDirection] = useRecoilState(store.chatDirection);
  const localize = useLocalize();

  const toggleChatDirection = () => {
    setDirection((prev) => (prev === 'LTR' ? 'RTL' : 'LTR'));
  };

  return (
    <SettingRow
      id="chat-direction"
      title={localize('com_nav_chat_direction')}
      control={
        <Button
          variant="outline"
          aria-label={localize('com_nav_chat_direction_selected', {
            direction:
              direction === 'LTR'
                ? localize('chat_direction_left_to_right')
                : localize('chat_direction_right_to_left'),
          })}
          onClick={toggleChatDirection}
          data-testid="chatDirection"
        >
          {direction.toLowerCase()}
        </Button>
      }
    />
  );
};

export default ChatDirection;
