import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import useInitPopoverInput from '../useInitPopoverInput';

const setSearchValue = jest.fn();
const setOpen = jest.fn();

function Probe({ text, adoptComposerText }: { text: string; adoptComposerText?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const initInputRef = useInitPopoverInput({
    inputRef,
    textAreaRef,
    commandChar: '+',
    setSearchValue,
    setOpen,
    adoptComposerText,
  });

  return (
    <>
      <textarea
        ref={(node) => {
          if (node) {
            node.value = text;
            textAreaRef.current = node;
          }
        }}
        data-testid="composer"
      />
      <input ref={initInputRef} data-testid="picker-search" />
    </>
  );
}

const composerValue = (container: HTMLElement) =>
  (container.querySelector('[data-testid="composer"]') as HTMLTextAreaElement).value;

describe('useInitPopoverInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('takes over a typed command, moving it into the picker search', () => {
    const { container } = render(<Probe text="+son" />);

    expect(setSearchValue).toHaveBeenCalledWith('son');
    expect(composerValue(container)).toBe('');
  });

  it('leaves a draft alone when the picker was opened from a button', () => {
    /** '+5 к зарплате…' is a message, not a command — it must survive the click. */
    const { container } = render(
      <Probe text="+5 к зарплате: как попросить?" adoptComposerText={false} />,
    );

    expect(setSearchValue).not.toHaveBeenCalled();
    expect(composerValue(container)).toBe('+5 к зарплате: как попросить?');
  });

  it('opens the picker either way', () => {
    render(<Probe text="" adoptComposerText={false} />);

    expect(setOpen).toHaveBeenCalledWith(true);
  });
});
