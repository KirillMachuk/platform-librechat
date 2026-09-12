const { selectAutoMatchedSkills } = require('./autoSkills');

describe('selectAutoMatchedSkills', () => {
  it.each([
    'Сделай презентацию на 5 слайдов о погоде в Минске',
    'Подготовь PPTX для совета директоров',
    'Обнови третий слайд в презентации',
    'Create a PowerPoint deck for the quarterly review',
  ])('matches an explicit presentation-delivery request: %s', (text) => {
    expect(selectAutoMatchedSkills({ spec: 'auto', text })).toEqual(['pptx']);
  });

  it.each([
    ['auto', 'Объясни, как создать презентацию'],
    ['auto', 'Please explain how to create a PowerPoint deck'],
    ['auto', 'Расскажи о погоде в Минске'],
    ['other', 'Сделай презентацию на 5 слайдов'],
    ['auto', ''],
  ])('does not prime pptx for %s / %s', (spec, text) => {
    expect(selectAutoMatchedSkills({ spec, text })).toEqual([]);
  });

  it.each([
    'Создай служебную записку для генерального директора в редактируемом DOCX и PDF',
    'Подготовь документ Word с таблицей показателей',
    'Create an editable DOCX memo for the executive team',
  ])('matches an explicit Word-document delivery request: %s', (text) => {
    expect(selectAutoMatchedSkills({ spec: 'auto', text })).toEqual(['docx']);
  });

  it.each([
    ['auto', 'Объясни, как создать документ Word'],
    ['auto', 'How can I make a Word document?'],
    ['other', 'Создай служебную записку в DOCX'],
    ['auto', 'Сделай краткое резюме этого текста'],
  ])('does not prime docx for %s / %s', (spec, text) => {
    expect(selectAutoMatchedSkills({ spec, text })).toEqual([]);
  });
});
