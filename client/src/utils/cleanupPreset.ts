import { parseConvo, getEndpointField } from 'librechat-data-provider';
import type { TPreset, TEndpointsConfig } from 'librechat-data-provider';

type UIPreset = Partial<TPreset> & { presetOverride?: Partial<TPreset> };
type TCleanupPreset = {
  preset?: UIPreset;
  defaultParamsEndpoint?: string | null;
  endpointsConfig?: TEndpointsConfig | null;
};

/**
 * `parseConvo` resolves a CUSTOM endpoint through `endpointType`, because a custom
 * endpoint's NAME is not a schema key — without it it throws `Unknown endpoint: <name>`
 * and takes its caller down. Conversations are not guaranteed to carry the field: a
 * Deep Research run persisted rows without it (fixed), and every such row already on
 * disk still lacks it. Resolving it from the endpoints config here — the same
 * `getEndpointField(…, 'type')` lookup `EndpointIcon` and `EndpointSettings` already
 * use — makes those rows work too, with no data migration. Stored value wins; the
 * config is the fallback, not an override.
 */
const cleanupPreset = ({
  preset: _preset,
  defaultParamsEndpoint,
  endpointsConfig,
}: TCleanupPreset): TPreset => {
  const { endpoint } = _preset ?? ({} as UIPreset);
  const endpointType = _preset?.endpointType ?? getEndpointField(endpointsConfig, endpoint, 'type');
  if (endpoint == null || endpoint === '') {
    console.error(`Unknown endpoint ${endpoint}`, _preset);
    return {
      endpoint: null,
      presetId: _preset?.presetId ?? null,
      title: _preset?.title ?? 'New Preset',
    };
  }

  const { presetOverride = {}, ...rest } = _preset ?? {};
  const preset = { ...rest, ...presetOverride };

  // Handle deprecated chatGptLabel field
  // If both chatGptLabel and modelLabel exist, prioritize modelLabel and remove chatGptLabel
  // If only chatGptLabel exists, migrate it to modelLabel
  if (preset.chatGptLabel && preset.modelLabel) {
    // Both exist: prioritize modelLabel, remove chatGptLabel
    delete preset.chatGptLabel;
  } else if (preset.chatGptLabel && !preset.modelLabel) {
    // Only chatGptLabel exists: migrate to modelLabel
    preset.modelLabel = preset.chatGptLabel;
    delete preset.chatGptLabel;
  } else if ('chatGptLabel' in preset) {
    // chatGptLabel exists but is empty/falsy: remove it
    delete preset.chatGptLabel;
  }

  const parsedPreset = parseConvo({
    /* @ts-ignore: endpoint can be a custom defined name */
    endpoint,
    endpointType,
    conversation: preset,
    defaultParamsEndpoint,
  });

  return {
    presetId: _preset?.presetId ?? null,
    ...parsedPreset,
    endpoint,
    endpointType,
    title: _preset?.title ?? 'New Preset',
  } as TPreset;
};

export default cleanupPreset;
