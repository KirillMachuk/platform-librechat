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
    ['auto', 'Расскажи о погоде в Минске'],
    ['other', 'Сделай презентацию на 5 слайдов'],
    ['auto', ''],
  ])('does not prime pptx for %s / %s', (spec, text) => {
    expect(selectAutoMatchedSkills({ spec, text })).toEqual([]);
  });
});
