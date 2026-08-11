// const { fontFamily } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    // Include component library files
    '../packages/client/src/**/*.{js,jsx,ts,tsx}',
  ],
  // darkMode: 'class',
  darkMode: ['class'],
  theme: {
    fontFamily: {
      sans: ['Inter Variable', 'Inter', 'sans-serif'],
      mono: ['Roboto Mono', 'monospace'],
    },
    // fontFamily: {
    //   sans: ['Söhne', 'sans-serif'],
    //   mono: ['Söhne Mono', 'monospace'],
    // },
    extend: {
      width: {
        authPageWidth: '370px',
      },
      // Канонная шкала слоёв (DESIGN_SYSTEM §4). До неё в форке жило два
      // десятка разных чисел, и порядок между оверлеями получался случайным:
      // списки в «Настройках» оказывались под диалогом настроек и не
      // открывались вовсе. Значения берутся из слоя токенов, а не пишутся
      // числами в разметке.
      //
      // Слой окон один — `dialog`. Кто из окон выше, решает порядок открытия,
      // а не число: разбор в style.css рядом с токенами.
      zIndex: {
        sticky: 'var(--c-z-sticky)',
        'scrim-drawer': 'var(--c-z-scrim-drawer)',
        drawer: 'var(--c-z-drawer)',
        dialog: 'var(--c-z-dialog)',
        popover: 'var(--c-z-popover)',
        toast: 'var(--c-z-toast)',
        dragdrop: 'var(--c-z-dragdrop)',
      },
      // Канон §4 знает ровно две тени — карточки и оверлеи, и обе в тёмной
      // теме заметно плотнее, чем даёт Tailwind по умолчанию. Значения
      // объявлены в слое токенов с Ф2a и до сих пор не имели потребителя.
      // shadow-md/xl/2xl остаются дефолтными до своих партий.
      boxShadow: {
        sm: 'var(--c-shadow-sm)',
        lg: 'var(--c-shadow-lg)',
        /* The one shadow beyond the two: the switch knob. The prototype draws
           it itself (`.sw::before`, 0 1px 3px .3) — a knob with no edge sinks
           into the accent track. Named so the shadow guard can tell it from
           drift: the guard bans the SCALE and arbitrary values, not tokens. */
        knob: '0 1px 3px rgba(0, 0, 0, 0.3)',
      },
      // Канон §5 знает две длительности: 90 мс цвет/наведение, 120 мс
      // появление. Произвольное `duration-[90ms]` Tailwind считает
      // неоднозначным и МОЛЧА не выпускает правило — проверено на собранном
      // CSS, поэтому имена заводятся здесь.
      transitionDuration: {
        90: 'var(--c-dur)',
        120: 'var(--c-dur-mid)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-out-left': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'slide-out-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'slide-in-left': 'slide-in-left 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'slide-out-left': 'slide-out-left 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'slide-out-right': 'slide-out-right 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
      },
      colors: {
        gray: {
          20: '#ececf1',
          50: '#f7f7f8',
          100: '#ececec',
          200: '#e3e3e3',
          300: '#cdcdcd',
          400: '#999696',
          500: '#595959',
          600: '#424242',
          700: '#2f2f2f',
          800: '#212121',
          850: '#171717',
          900: '#0d0d0d',
        },
        green: {
          50: '#f1f9f7',
          100: '#def2ed',
          200: '#a6e5d6',
          300: '#6dc8b9',
          400: '#41a79d',
          500: '#10a37f',
          550: '#349072',
          600: '#126e6b',
          700: '#0a4f53',
          800: '#06373e',
          900: '#031f29',
        },
        'brand-purple': 'var(--brand-purple)',
        presentation: 'var(--presentation)',
        scrim: 'var(--c-scrim)',
        ink: 'var(--c-ink)',
        'ink-label': 'var(--c-ink-label)',
        /* The accent, and what reads ON TOP of it — a label on an accent-filled
           plate, the knob of a switch that is on (canon §6.4). Straight off the
           palette, like `ink`, and deliberately not through `brand-purple`:
           that name is declared twice, once on `:root` as upstream's #ab68ff
           and once on `html` as our accent, and `:root` wins on specificity no
           matter the order — so anything painted `brand-purple` came out
           violet. */
        acc: 'var(--c-acc)',
        'acc-ink': 'var(--c-acc-ink)',
        /* The SELECTED-state tint (§1.4: selection is said with tint, not
           weight). Settings tabs, segmented controls and the temporary-chat
           chip used to borrow the focus-ring token for this background — and
           the day focus went neutral, that token went transparent and took
           their tint with it. Selection and focus are different jobs; they
           get different tokens. */
        'acc-soft': 'var(--c-acc-soft)',
        // Пузырь пользователя (§6.13). Значение с Ф2a, потребителя до сих пор не
        // было: пузырь красился сырым #F3F3F3 с отдельным правилом для тьмы.
        bubble: 'var(--c-bubble)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-secondary-alt': 'var(--text-secondary-alt)',
        'text-tertiary': 'var(--text-tertiary)',
        // Канон §1.1 отдаёт петроль ссылкам и активным состояниям; до сих пор
        // акцентного ТЕКСТА в словаре не было, и ссылки красились сырым
        // text-green-600. Имя `accent` уже занято поверхностью из shadcn,
        // поэтому ключ живёт в семье text-* — класс `text-text-accent`.
        'text-accent': 'var(--c-acc)',
        'text-warning': 'var(--text-warning)',
        'text-destructive': 'var(--text-destructive)',
        'ring-primary': 'var(--ring-primary)',
        'ring-primary-soft': 'var(--ring-primary-soft)',
        // Мягкая подложка ошибки: кольцо фокуса поля в ошибке (§6.4) и инлайн-
        // алерты форм (§6.9). Значение с Ф2a, потребителей до сих пор не было.
        'err-soft': 'var(--c-err-soft)',
        'header-primary': 'var(--header-primary)',
        'header-hover': 'var(--header-hover)',
        'header-button-hover': 'var(--header-button-hover)',
        'surface-active': 'var(--surface-active)',
        'surface-active-alt': 'var(--surface-active-alt)',
        'surface-hover': 'var(--surface-hover)',
        'surface-hover-alt': 'var(--surface-hover-alt)',
        'surface-primary': 'var(--surface-primary)',
        'surface-primary-alt': 'var(--surface-primary-alt)',
        'surface-primary-contrast': 'var(--surface-primary-contrast)',
        'surface-secondary': 'var(--surface-secondary)',
        'surface-secondary-alt': 'var(--surface-secondary-alt)',
        'surface-tertiary': 'var(--surface-tertiary)',
        'surface-tertiary-alt': 'var(--surface-tertiary-alt)',
        'surface-dialog': 'var(--surface-dialog)',
        'surface-submit': 'var(--surface-submit)',
        'surface-submit-hover': 'var(--surface-submit-hover)',
        'surface-destructive': 'var(--surface-destructive)',
        'surface-destructive-hover': 'var(--surface-destructive-hover)',
        'surface-chat': 'var(--surface-chat)',
        /* §2 code-bg / code-ink — единственная подложка и чернила код-блока.
           Токен уже следует теме сам (:root/.dark в style.css), поэтому
           dark:-вариантов у потребителей быть не должно (§10.2). */
        'surface-code': 'var(--c-code-bg)',
        'code-ink': 'var(--c-code-ink)',
        'border-control': 'var(--border-control)',
        'border-focus': 'var(--border-focus)',
        'border-light': 'var(--border-light)',
        'border-medium': 'var(--border-medium)',
        'border-medium-alt': 'var(--border-medium-alt)',
        'border-heavy': 'var(--border-heavy)',
        'border-xheavy': 'var(--border-xheavy)',
        'border-destructive': 'var(--border-destructive)',
        /* These are test styles */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ['switch-unchecked']: 'hsl(var(--switch-unchecked))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('tailwindcss-radix'),
    // require('@tailwindcss/typography'),
  ],
};
