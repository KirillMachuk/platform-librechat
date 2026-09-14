import { useMutation } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

export interface AbortStreamParams {
  /** The stream ID to abort (if known) */
  streamId?: string;
  /** The conversation ID to abort (backend will look up the job) */
  conversationId?: string;
}

export interface AbortStreamResponse {
  success: boolean;
  aborted?: string;
  error?: string;
}

/**
 * Abort an ongoing generation stream.
 * The backend will emit a `done` event with `aborted: true` to the SSE stream,
 * allowing the client to handle cleanup via the normal event flow.
 *
 * Can pass either streamId or conversationId - backend will find the job.
 */
export const abortStream = async (params: AbortStreamParams): Promise<AbortStreamResponse> => {
  console.log('[abortStream] Calling abort endpoint with params:', params);
  const result = (await request.post(
    `${apiBaseUrl()}/api/agents/chat/abort`,
    params,
  )) as AbortStreamResponse;
  console.log('[abortStream] Abort response:', result);
  return result;
};

export interface SteerStreamParams {
  conversationId: string;
  text: string;
}

export interface SteerStreamResponse {
  /** The persisted clarification (a plain user message, drKind 'steer'). */
  message: TMessage;
  /** The branch head the clarification was hung under — the running answer's
   *  parent until now; the answer moves under the clarification. */
  parentMessageId: string;
  /** How many clarifications this run has taken, this one included. */
  accepted: number;
}

/**
 * Hand a running Deep Research job a clarification (mid-run steering). The run
 * reads it at the start of its next round; the server refuses with a reason
 * and a next step when it cannot take it (`error` in the response body).
 */
export const steerStream = async (params: SteerStreamParams): Promise<SteerStreamResponse> => {
  return (await request.post(
    `${apiBaseUrl()}/api/agents/chat/steer`,
    params,
  )) as SteerStreamResponse;
};

/**
 * React Query mutation hook for aborting a generation stream.
 * Use this when the user explicitly clicks the stop button.
 */
export function useAbortStreamMutation() {
  return useMutation({
    mutationFn: abortStream,
  });
}
