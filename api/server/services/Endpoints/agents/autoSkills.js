/**
 * Returns skills that must be available before an Auto request reaches the
 * model. This is deliberately narrow: it prevents a presentation request
 * from depending on a model deciding to load the PPTX workflow, without
 * putting that workflow in the context of ordinary chats.
 */
function selectAutoMatchedSkills({ spec, text }) {
  if (typeof spec !== 'string' || spec.toLowerCase() !== 'auto' || typeof text !== 'string') {
    return [];
  }

  const normalized = text.toLowerCase();
  const requestsPresentation =
    /\b(pptx|ppt|powerpoint|presentation|presentations|deck|decks|slide|slides)\b/.test(
      normalized,
    ) || /презентац|слайд/.test(normalized);
  const requestsCreation =
    /\b(create|make|build|prepare|generate|update|edit|revise|attach|export)\b/.test(normalized) ||
    /(создай|сделай|подготовь|собери|сгенерируй|оформи|обнови|измени|доработай|переделай|приложи|выгрузи|экспортируй|отправь)/.test(
      normalized,
    );

  return requestsPresentation && requestsCreation ? ['pptx'] : [];
}

module.exports = { selectAutoMatchedSkills };
