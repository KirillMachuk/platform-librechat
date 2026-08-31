// file deepcode ignore HardcodedNonCryptoSecret: No hardcoded secrets
import { ViolationTypes, ErrorTypes, alternateName } from 'librechat-data-provider';
import type { LocalizeFunction } from '~/common';
import type { TranslationKeys } from '~/hooks';
import { formatJSON, extractJson, isJson } from '~/utils/json';
import { useLocalize } from '~/hooks';
import CodeBlock from './CodeBlock';

const localizedErrorPrefix = 'com_error';

type TConcurrent = {
  limit: number;
};

type TMessageLimit = {
  max: number;
  windowInMinutes: number;
};

type TTokenBalance = {
  type: ViolationTypes | ErrorTypes;
  balance: number;
  tokenCost: number;
  promptTokens: number;
  prev_count: number;
  violation_count: number;
  date: Date;
  generations?: unknown[];
};

type TExpiredKey = {
  expiredAt: string;
  endpoint: string;
};

type TGenericError = {
  info: string;
};

const errorMessages = {
  [ErrorTypes.MODERATION]: 'com_error_moderation',
  [ErrorTypes.NO_USER_KEY]: 'com_error_no_user_key',
  [ErrorTypes.INVALID_USER_KEY]: 'com_error_invalid_user_key',
  [ErrorTypes.NO_BASE_URL]: 'com_error_no_base_url',
  [ErrorTypes.INVALID_BASE_URL]: 'com_error_invalid_base_url',
  [ErrorTypes.INVALID_ACTION]: `com_error_${ErrorTypes.INVALID_ACTION}`,
  [ErrorTypes.INVALID_REQUEST]: `com_error_${ErrorTypes.INVALID_REQUEST}`,
  [ErrorTypes.REFUSAL]: 'com_error_refusal',
  [ErrorTypes.MISSING_MODEL]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info: endpoint } = json;
    const provider = (alternateName[endpoint ?? ''] as string | undefined) ?? endpoint ?? 'unknown';
    return localize('com_error_missing_model', { 0: provider });
  },
  [ErrorTypes.MODELS_NOT_LOADED]: 'com_error_models_not_loaded',
  [ErrorTypes.ENDPOINT_MODELS_NOT_LOADED]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info: endpoint } = json;
    const provider = (alternateName[endpoint ?? ''] as string | undefined) ?? endpoint ?? 'unknown';
    return localize('com_error_endpoint_models_not_loaded', { 0: provider });
  },
  [ErrorTypes.NO_SYSTEM_MESSAGES]: `com_error_${ErrorTypes.NO_SYSTEM_MESSAGES}`,
  [ErrorTypes.EXPIRED_USER_KEY]: (json: TExpiredKey, localize: LocalizeFunction) => {
    const { expiredAt, endpoint } = json;
    return localize('com_error_expired_user_key', { 0: endpoint, 1: expiredAt });
  },
  [ErrorTypes.INPUT_LENGTH]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    return localize('com_error_input_length', { 0: info });
  },
  [ErrorTypes.INVALID_AGENT_PROVIDER]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    const provider = (alternateName[info] as string | undefined) ?? info;
    return localize('com_error_invalid_agent_provider', { 0: provider });
  },
  [ErrorTypes.GOOGLE_ERROR]: (json: TGenericError) => {
    const { info } = json;
    return info;
  },
  [ErrorTypes.GOOGLE_TOOL_CONFLICT]: 'com_error_google_tool_conflict',
  [ErrorTypes.REASONING_MODEL_TOOLS]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    const model = info?.split('/').pop() ?? info ?? '';
    return localize('com_error_reasoning_model_tools', { 0: model });
  },
  [ErrorTypes.DEEP_RESEARCH_MODEL_INCOMPATIBLE]: 'com_error_deep_research_model_incompatible',
  [ErrorTypes.STREAM_EXPIRED]: 'com_error_stream_expired',
  [ErrorTypes.GENERATION_INTERRUPTED]: 'com_error_generation_interrupted',
  /** The run broke with finished work already in the message. Lead with what survived —
   *  the default frame («Не удалось выполнить запрос») denies files the user can see
   *  and scroll to, and pushes them into paying for the same run twice. */
  [ErrorTypes.RUN_INCOMPLETE]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    return localize('com_error_run_incomplete', { 0: info ?? '' });
  },
  [ViolationTypes.BAN]: 'com_error_ban',
  [ViolationTypes.ILLEGAL_MODEL_REQUEST]: (json: TGenericError, localize: LocalizeFunction) => {
    const { info } = json;
    const [endpoint, model = 'unknown'] = info?.split('|') ?? [];
    const provider = (alternateName[endpoint ?? ''] as string | undefined) ?? endpoint ?? 'unknown';
    return localize('com_error_illegal_model_request', { 0: model, 1: provider });
  },
  invalid_api_key: 'com_error_invalid_api_key',
  insufficient_quota: 'com_error_insufficient_quota',
  concurrent: (json: TConcurrent, localize: LocalizeFunction) => {
    const { limit } = json;
    return localize('com_error_concurrent', { 0: limit });
  },
  message_limit: (json: TMessageLimit, localize: LocalizeFunction) => {
    const { max, windowInMinutes } = json;
    return localize('com_error_message_limit', { 0: max, 1: windowInMinutes });
  },
  token_balance: (json: TTokenBalance, localize: LocalizeFunction) => {
    const { generations } = json;
    return (
      <>
        {localize('com_error_token_balance')}
        {generations && (
          <>
            <br />
            <br />
          </>
        )}
        {generations && (
          <CodeBlock
            lang="Generations"
            error={true}
            codeChildren={formatJSON(JSON.stringify(generations))}
          />
        )}
      </>
    );
  },
};

const Error = ({ text }: { text: string }) => {
  const localize = useLocalize();
  const jsonString = extractJson(text);
  /** `extractJson` matches balanced braces, not JSON, so a plain message that merely
   *  contains `{...}` used to skip the cut and print in full. The cut belongs to messages
   *  we cannot parse — which is exactly `!structured`. */
  const structured = isJson(jsonString);
  const errorMessage = text.length > 512 && !structured ? text.slice(0, 512) + '...' : text;
  /** Localized: the server already answers in the user's language (getUserFacingError returns
   *  curated Russian sentences), so a hardcoded English lead-in put two languages in one
   *  bubble. The English wording is unchanged. */
  const defaultResponse = localize('com_error_generic_prefix', { 0: errorMessage });

  if (!structured) {
    return defaultResponse;
  }

  const json = JSON.parse(jsonString);
  const errorKey = json.code || json.type;
  /** Own keys only. `errorMessages` is an object literal, so a body carrying
   *  `{"code":"hasOwnProperty"}` used to resolve to an inherited Object method, which this
   *  then called as a handler — a TypeError thrown during render, taking the message list
   *  with it. The key comes from an error body, so it is not ours to trust. */
  const handler =
    typeof errorKey === 'string' && Object.prototype.hasOwnProperty.call(errorMessages, errorKey)
      ? errorMessages[errorKey]
      : undefined;

  if (typeof handler === 'function') {
    return handler(json, localize);
  }
  if (typeof handler === 'string') {
    return handler.startsWith(localizedErrorPrefix)
      ? localize(handler as TranslationKeys)
      : handler;
  }
  return defaultResponse;
};

export default Error;
