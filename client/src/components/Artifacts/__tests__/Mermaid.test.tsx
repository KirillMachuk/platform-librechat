import React from 'react';
import { render, waitFor } from '@testing-library/react';

const mockInitialize = jest.fn();
const mockRender = jest.fn();

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

jest.mock('react-zoom-pan-pinch', () => ({
  TransformWrapper: (props) => {
    const { children } = props;
    return (
      <div>
        {typeof children === 'function'
          ? children({ zoomIn: jest.fn(), zoomOut: jest.fn() })
          : children}
      </div>
    );
  },
  TransformComponent: (props) => <div>{props.children}</div>,
}));

jest.mock('@librechat/client', () => ({
  Button: (props) => <button>{props.children}</button>,
}));

jest.mock('~/utils/mermaid', () => ({ artifactFlowchartConfig: {} }));

import MermaidDiagram from '../Mermaid';

describe('MermaidDiagram — fullscreen DoS hardening (D15b)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRender.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' });
  });

  it('initializes mermaid with DoS caps and sandbox isolation', async () => {
    render(<MermaidDiagram content="graph TD; A-->B" />);
    await waitFor(() => expect(mockInitialize).toHaveBeenCalled());
    expect(mockInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'sandbox',
        maxTextSize: 50000,
        maxEdges: 500,
      }),
    );
  });

  it('injects the rendered svg on success', async () => {
    const { container } = render(<MermaidDiagram content="graph TD; A-->B" />);
    await waitFor(() => expect(container.querySelector('[data-testid="diagram"]')).toBeTruthy());
  });

  it('shows an error state when rendering rejects', async () => {
    mockRender.mockRejectedValue(new Error('bad syntax'));
    const { container } = render(<MermaidDiagram content="!!invalid" />);
    await waitFor(() => expect(container.innerHTML).toContain('Error rendering diagram'));
  });
});
