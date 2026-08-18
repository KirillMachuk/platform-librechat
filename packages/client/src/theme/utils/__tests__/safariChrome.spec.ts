import syncSafariChrome from '../safariChrome';

/* 17.08-2: бары Safari красились от OS-темы, а страница — от темы приложения.
 * Runtime-мета обязана (1) нести цвет АКТИВНОЙ темы из токена --c-card,
 * (2) стоять ПЕРВОЙ в <head> — по спецификации побеждает первая подходящая,
 * (3) обновляться, а не плодиться. */
describe('syncSafariChrome', () => {
  const staticMeta = () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.setAttribute('media', '(prefers-color-scheme: dark)');
    meta.setAttribute('content', '#232323');
    return meta;
  };

  beforeEach(() => {
    document.head.innerHTML = '';
    document.head.appendChild(staticMeta());
    document.documentElement.style.setProperty('--c-card', '#ffffff');
  });

  it('inserts a runtime meta FIRST in head with the token color', () => {
    syncSafariChrome();
    const first = document.head.firstChild as HTMLMetaElement;
    expect(first.getAttribute('name')).toBe('theme-color');
    expect(first.getAttribute('data-app-theme-color')).toBe('1');
    expect(first.getAttribute('content')).toBe('#ffffff');
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
  });

  it('updates the same meta on theme change instead of duplicating', () => {
    syncSafariChrome();
    document.documentElement.style.setProperty('--c-card', '#232323');
    syncSafariChrome();
    const runtime = document.querySelectorAll('meta[data-app-theme-color]');
    expect(runtime).toHaveLength(1);
    expect((runtime[0] as HTMLMetaElement).getAttribute('content')).toBe('#232323');
    expect(document.head.firstChild).toBe(runtime[0]);
  });

  it('does nothing when the token is not defined (pre-hydration safety)', () => {
    document.documentElement.style.removeProperty('--c-card');
    syncSafariChrome();
    expect(document.querySelector('meta[data-app-theme-color]')).toBeNull();
  });
});
