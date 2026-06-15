import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { RecoilRoot } from 'recoil';
import type { MutableSnapshot } from 'recoil';
import { render, fireEvent } from 'test/layout-test-utils';
import ConversationModeSwitch from './ConversationModeSwitch';
import store from '~/store';

describe('ConversationModeSwitch', () => {
  /**
   * Mock function to set the conversation-mode state.
   */
  let mockSetConversationMode: jest.Mock<void, [boolean]> | ((value: boolean) => void) | undefined;

  beforeEach(() => {
    mockSetConversationMode = jest.fn();
  });

  it('renders correctly', () => {
    const { getByTestId } = render(
      <RecoilRoot>
        <ConversationModeSwitch />
      </RecoilRoot>,
    );

    expect(getByTestId('ConversationMode')).toBeInTheDocument();
  });

  it('is disabled by default because speech-to-text is off', () => {
    // Conversation mode requires both text-to-speech and speech-to-text. Stage-1 speech
    // defaults ship with the microphone (speechToText) OFF, so the switch is disabled and
    // toggling it is a no-op.
    const { getByTestId } = render(
      <RecoilRoot>
        <ConversationModeSwitch onCheckedChange={mockSetConversationMode} />
      </RecoilRoot>,
    );
    const switchElement = getByTestId('ConversationMode');

    expect(switchElement).toBeDisabled();

    fireEvent.click(switchElement);
    expect(mockSetConversationMode).not.toHaveBeenCalled();
  });

  it('calls onCheckedChange when toggled and speech features are enabled', () => {
    const initializeState = (snapshot: MutableSnapshot) => {
      snapshot.set(store.speechToText, true);
      snapshot.set(store.textToSpeech, true);
    };
    const { getByTestId } = render(
      <RecoilRoot initializeState={initializeState}>
        <ConversationModeSwitch onCheckedChange={mockSetConversationMode} />
      </RecoilRoot>,
    );
    const switchElement = getByTestId('ConversationMode');

    expect(switchElement).not.toBeDisabled();

    fireEvent.click(switchElement);
    // conversationMode defaults to false, so the first toggle turns it on.
    expect(mockSetConversationMode).toHaveBeenCalledWith(true);
  });
});
