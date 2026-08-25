import React from 'react';
import type { UIActionResult } from '@mcp-ui/client';
import { TAskFunction } from '~/common';
import logger from './logger';

export * from './map';
export * from './chatColumn';
export * from './json';
export * from './text';
export * from './sentences';
export * from './icons';
export * from './email';
export * from './share';
export * from './brand';
export * from './files';
export * from './latex';
export * from './tilde';
export * from './forms';
export * from './roles';
export * from './errors';
export * from './agents';
export * from './drafts';
export * from './convos';
export * from './routes';
export * from './composer';
export * from './convoPath';
export * from './presets';
export * from './prompts';
export * from './textarea';
export * from './messages';
export * from './tokens';
export * from './redirect';
export * from './languages';
export * from './conversation';
export * from './endpoints';
export * from './resources';
export * from './configHtml';
export * from './downloadFile';
export * from './documentCard';
export * from './scaleImage';
export * from './timestamps';
export * from './localStorage';
export * from './promptGroups';
export * from './previewCache';
export * from './groupToolCalls';
export * from './toolLabels';
export * from './favoritesError';
export { default as cn } from './cn';
export { default as logger } from './logger';
export { default as getLoginError } from './getLoginError';
export { default as cleanupPreset } from './cleanupPreset';
export { default as buildDefaultConvo } from './buildDefaultConvo';
export { default as getDefaultEndpoint } from './getDefaultEndpoint';
export { default as createChatSearchParams, processValidSettings } from './createChatSearchParams';
export { getThemeFromEnv } from './getThemeFromEnv';

export const languages = [
  'java',
  'c',
  'markdown',
  'css',
  'html',
  'xml',
  'bash',
  'json',
  'yaml',
  'jsx',
  'python',
  'c++',
  'javascript',
  'csharp',
  'php',
  'typescript',
  'swift',
  'objectivec',
  'sql',
  'r',
  'kotlin',
  'ruby',
  'go',
  'x86asm',
  'matlab',
  'perl',
  'pascal',
];

export const removeFocusOutlines = '';
export const removeFocusRings = 'focus:outline-none';

export const cardStyle =
  'transition-colors rounded-md min-w-[75px] border font-normal bg-white hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700 dark:bg-gray-800 text-black dark:text-gray-600 focus:outline-none data-[state=open]:bg-gray-50 dark:data-[state=open]:bg-gray-700';

/* Focus is canon §1.8 for fields: `acc` border + 3px `acc-soft` ring, no
   ring-offset. The offset is what painted the white gap under the accent ring
   — Tailwind's offset colour defaults to #fff even in dark theme, which is
   the "и синим и белым" double glow the owner reported on the agent builder. */
export const defaultTextProps =
  'rounded-md border border-gray-200 focus:border-border-focus bg-transparent text-sm outline-none focus-within:placeholder:text-text-primary focus:placeholder:text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-[3px] focus:ring-ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-50 dark:focus:outline-none';

export const optionText =
  'p-0 shadow-none text-right pr-1 h-8 border-transparent hover:bg-gray-800/10 dark:hover:bg-white/10 dark:focus:bg-white/10 transition-colors';

export const defaultTextPropsLabel =
  'rounded-md border border-gray-300 bg-transparent text-sm outline-none focus-within:placeholder:text-text-primary focus:placeholder:text-text-primary placeholder:text-text-secondary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-50 dark:focus:border-gray-600 dark:focus:outline-none';

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export const handleDoubleClick: React.MouseEventHandler<HTMLElement> = (event) => {
  const range = document.createRange();
  range.selectNodeContents(event.target as Node);
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
};

export const extractContent = (
  children: React.ReactNode | { props: { children: React.ReactNode } } | string,
): string => {
  if (typeof children === 'string') {
    return children;
  }
  if (React.isValidElement(children)) {
    return extractContent((children.props as { children?: React.ReactNode }).children);
  }
  if (Array.isArray(children)) {
    return children.map(extractContent).join('');
  }
  return '';
};

export const handleUIAction = async (result: UIActionResult, ask: TAskFunction) => {
  const supportedTypes = ['intent', 'tool', 'prompt'];

  const { type, payload } = result;

  if (!supportedTypes.includes(type)) {
    return;
  }

  let messageText = '';

  if (type === 'intent') {
    const { intent, params } = payload;
    messageText = `The user clicked a button in an embedded UI Resource, and we got a message of type \`intent\`.
The intent is \`${intent}\` and the params are:

\`\`\`json
${JSON.stringify(params, null, 2)}
\`\`\`

Execute the intent that is mentioned in the message using the tools available to you.
    `;
  } else if (type === 'tool') {
    const { toolName, params } = payload;
    messageText = `The user clicked a button in an embedded UI Resource, and we got a message of type \`tool\`.
The tool name is \`${toolName}\` and the params are:

\`\`\`json
${JSON.stringify(params, null, 2)}
\`\`\`

Execute the tool that is mentioned in the message using the tools available to you.
    `;
  } else if (type === 'prompt') {
    const { prompt } = payload;
    messageText = `The user clicked a button in an embedded UI Resource, and we got a message of type \`prompt\`.
The prompt is:

\`\`\`
${prompt}
\`\`\`

Execute the intention of the prompt that is mentioned in the message using the tools available to you.
    `;
  }

  logger.debug('MCP-UI', 'About to submit message:', messageText);
  ask({ text: messageText });
  logger.debug('MCP-UI', 'Message submitted successfully');
};
