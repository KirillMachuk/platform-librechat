import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import Results from '../Results';

/**
 * The search results list, driven by stubbed queries instead of a real search
 * engine. The e2e profile runs with `SEARCH=false` and hides the search entry
 * entirely, so the states a user actually meets — spinner, "nothing found",
 * "no chats yet", recent chats grouped by date, and results split into chats
 * and messages — have no other place to be proven.
 */
type QueryState = {
  data?: { pages: Array<Record<string, unknown>> };
  isLoading?: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
};

type QueryCall = { search?: string; enabled?: boolean };

const conversationsState: { current: QueryState } = { current: {} };
const messagesState: { current: QueryState } = { current: {} };
const recentsState: { current: QueryState } = { current: {} };

const conversationCalls: QueryCall[] = [];
const messageCalls: QueryCall[] = [];

/* A function, not a shared object: spreading one literal into three states left
 * all three holding the same `pages` array, so a test that pushed into one
 * silently changed the others. */
const idle = (): QueryState => ({
  data: { pages: [{ conversations: [] }] },
  isLoading: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  fetchNextPage: () => undefined,
});

jest.mock('react-router-dom', () => ({
  useNavigate: () => () => undefined,
}));

/**
 * Recents and search are the same hook called twice, told apart by `search`.
 * With an empty box both calls pass `search: undefined` and both land on the
 * recents state — harmless, because the component reads the search results
 * only when there is a query, and the recorded `enabled` flags below prove the
 * second call is switched off rather than merely ignored.
 */
jest.mock('~/data-provider', () => ({
  useConversationsInfiniteQuery: (params: { search?: string }, options?: { enabled?: boolean }) => {
    conversationCalls.push({ search: params.search, enabled: options?.enabled });
    return params.search == null ? recentsState.current : conversationsState.current;
  },
  useMessagesInfiniteQuery: (params: { search?: string }, options?: { enabled?: boolean }) => {
    messageCalls.push({ search: params.search, enabled: options?.enabled });
    return messagesState.current;
  },
}));

/* Only the two hooks this tree uses. Pulling the real `~/hooks` barrel drags in
 * the audio and chat stacks and fails to load at all; the localiser here reads
 * the real English file, so a renamed or missing key still fails the test. */
jest.mock('~/hooks', () => {
  const english = jest.requireActual('~/locales/en/translation.json');
  return {
    useAuthContext: () => ({ isAuthenticated: true }),
    useLocalize: () => (key: string) => english[key] ?? key,
  };
});

/* jsdom has no IntersectionObserver, and the list uses one to load the next
 * page when its sentinel scrolls into view. */
beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: NoopObserver,
  });
});

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const conversation = (
  conversationId: string,
  title: string,
  updatedAt = new Date().toISOString(),
) => ({
  conversationId,
  title,
  updatedAt,
});

const renderResults = (query: string) =>
  render(
    <RecoilRoot>
      <Results query={query} onSelect={() => undefined} />
    </RecoilRoot>,
  );

beforeEach(() => {
  conversationsState.current = idle();
  messagesState.current = { ...idle(), data: { pages: [{ messages: [] }] } };
  recentsState.current = idle();
  conversationCalls.length = 0;
  messageCalls.length = 0;
});

describe('search results', () => {
  /**
   * A spinner is the honest state here; an empty box would read as "nothing
   * found" while the answer is still on its way.
   *
   * It is found by class, not by role, because the shared Spinner renders as
   * `<svg class="spinner" aria-hidden="true">` — it carries no role and no live
   * region, so a screen reader is told nothing at all while a search runs. That
   * is a real defect, recorded in e2e/COVERAGE_MAP.md rather than papered over
   * here; when it is fixed, this locator should become `getByRole('status')`.
   */
  it('shows a spinner while a search is still running', () => {
    conversationsState.current = { ...idle(), isLoading: true };
    const { container } = renderResults('договор');

    expect(container.querySelector('.spinner')).toBeInTheDocument();
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument();
    expect(screen.queryByText('No chats yet')).not.toBeInTheDocument();
  });

  it('says plainly that a search found nothing', () => {
    renderResults('договор');

    expect(screen.getByText('Nothing found')).toBeInTheDocument();
  });

  it('says there are no chats yet when nothing has been searched for', () => {
    renderResults('');

    expect(screen.getByText('No chats yet')).toBeInTheDocument();
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument();
  });

  /**
   * The empty box is not empty in real use — it lists what the user was last
   * working on, under date headings. Nothing exercised this branch before, so
   * the recents state could have been wired to the search state and every
   * other test here would still have passed.
   */
  it('lists recent chats under date headings when nothing has been typed', () => {
    recentsState.current = {
      ...idle(),
      data: {
        pages: [
          {
            conversations: [
              conversation('c-today', 'Сегодняшний договор'),
              conversation('c-older', 'Прошлая смета', daysAgo(3)),
            ],
          },
        ],
      },
    };
    renderResults('');

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Сегодняшний договор')).toBeInTheDocument();
    expect(screen.getByText('Previous 7 days')).toBeInTheDocument();
    expect(screen.getByText('Прошлая смета')).toBeInTheDocument();
    expect(screen.queryByText('No chats yet')).not.toBeInTheDocument();
  });

  /**
   * An empty box must not send the search engine a query for everything, and a
   * typed query must not keep refetching the recents list underneath it. Both
   * are decided by `enabled`, which no rendered output reveals.
   */
  it('runs recents or search, never both', () => {
    renderResults('');

    expect(conversationCalls).toEqual([
      { search: undefined, enabled: true },
      { search: undefined, enabled: false },
    ]);
    expect(messageCalls).toEqual([{ search: undefined, enabled: false }]);

    conversationCalls.length = 0;
    messageCalls.length = 0;
    renderResults('договор');

    expect(conversationCalls).toEqual([
      { search: undefined, enabled: false },
      { search: 'договор', enabled: true },
    ]);
    expect(messageCalls).toEqual([{ search: 'договор', enabled: true }]);
  });

  it('separates matching chats from matching messages', () => {
    conversationsState.current = {
      ...idle(),
      data: { pages: [{ conversations: [conversation('c-1', 'Договор аренды')] }] },
    };
    messagesState.current = {
      ...idle(),
      data: {
        pages: [
          {
            messages: [
              {
                messageId: 'm-1',
                conversationId: 'c-2',
                title: 'Счета за июль',
                text: 'Оплата по договору прошла',
              },
            ],
          },
        ],
      },
    };
    renderResults('договор');

    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByText('Договор аренды')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Счета за июль')).toBeInTheDocument();
  });
});
