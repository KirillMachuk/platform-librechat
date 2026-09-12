/**
 * Returns skills that must be available before an Auto request reaches the
 * model. This is deliberately narrow: explicit editable-artifact requests
 * must not depend on a model deciding to load the matching workflow, while
 * ordinary explanatory chats stay free of unrelated authoring instructions.
 */
function selectAutoMatchedSkills({ spec, text }) {
  if (typeof spec !== 'string' || spec.toLowerCase() !== 'auto' || typeof text !== 'string') {
    return [];
  }

  const normalized = text.toLowerCase();
  const requestsInstructions =
    /^\s*(?:(?:please\s+)?(?:explain|tell|show)\b.{0,48}\bhow to\b|how\s+(?:do|can|should)\b)/.test(
      normalized,
    );
  if (requestsInstructions) {
    return [];
  }
  const requestsPresentation =
    /\b(pptx|ppt|powerpoint|presentation|presentations|deck|decks|slide|slides)\b/.test(
      normalized,
    ) || /презентац|слайд/.test(normalized);
  const requestsWordDocument =
    /\b(docx|microsoft word|word document|word file)\b/.test(normalized) ||
    /(?:документ|файл).{0,24}\bword\b|\bword\b.{0,24}(?:документ|файл)|ворд|служебн\S*\s+записк/.test(
      normalized,
    );
  const requestsCreation =
    /\b(create|make|build|prepare|generate|update|edit|revise|attach|export)\b/.test(normalized) ||
    /(создай|сделай|подготовь|собери|сгенерируй|оформи|обнови|измени|доработай|переделай|приложи|выгрузи|экспортируй|отправь)/.test(
      normalized,
    );

  const matched = [];
  if (requestsPresentation && requestsCreation) {
    matched.push('pptx');
  }
  if (requestsWordDocument && requestsCreation) {
    matched.push('docx');
  }
  return matched;
}

module.exports = { selectAutoMatchedSkills };
