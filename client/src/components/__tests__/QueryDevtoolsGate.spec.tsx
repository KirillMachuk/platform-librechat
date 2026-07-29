import { render, screen } from '@testing-library/react';
import QueryDevtoolsGate, { shouldEnableQueryDevtools } from '../QueryDevtoolsGate';

jest.mock('@tanstack/react-query-devtools/production', () => ({
  ReactQueryDevtools: () => <div data-testid="query-devtools" />,
}));

/**
 * The devtools arrive through `React.lazy`, so the assertions below wait on a
 * real Suspense boundary rather than a state update. `waitFor`'s default second
 * is not always enough for that on a machine running the whole suite in
 * parallel — the failure looked like "never rendered" while the fallback was
 * simply still showing.
 */
const LAZY_BOUNDARY_TIMEOUT = 5000;

describe('QueryDevtoolsGate', () => {
  it('keeps query devtools disabled in production by default', () => {
    expect(shouldEnableQueryDevtools({ isDevelopment: false, config: undefined })).toBe(false);

    const { container } = render(<QueryDevtoolsGate isDevelopment={false} config={undefined} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('query-devtools')).not.toBeInTheDocument();
  });

  it('enables query devtools in local development', async () => {
    render(<QueryDevtoolsGate isDevelopment={true} config={undefined} />);

    expect(
      await screen.findByTestId('query-devtools', {}, { timeout: LAZY_BOUNDARY_TIMEOUT }),
    ).toBeInTheDocument();
  });

  it('enables query devtools in production when the server-injected flag is true', async () => {
    render(<QueryDevtoolsGate isDevelopment={false} config={{ enableQueryDevtools: true }} />);

    expect(
      await screen.findByTestId('query-devtools', {}, { timeout: LAZY_BOUNDARY_TIMEOUT }),
    ).toBeInTheDocument();
  });
});
