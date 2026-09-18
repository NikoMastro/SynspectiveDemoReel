/**
 * The error state is a deliverable in its own right: a reviewer who opens the
 * app with the backend stopped should be told exactly what to start.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './StatusBlock';

describe('LoadingBlock', () => {
  it('announces itself to assistive technology and names the base URL', () => {
    render(<LoadingBlock what="the scene catalog" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading the scene catalog');
    expect(status).toHaveTextContent('/api/v1');
  });
});

describe('EmptyBlock', () => {
  it('says what is empty and what to do about it', () => {
    render(<EmptyBlock title="No scene selected" detail="Click a footprint." />);
    expect(screen.getByText('No scene selected')).toBeInTheDocument();
    expect(screen.getByText('Click a footprint.')).toBeInTheDocument();
  });
});

describe('ErrorBlock', () => {
  it('names the service, the port and how to start it when nothing answered', () => {
    render(
      <ErrorBlock
        what="the scene catalog"
        failure={{ message: 'Cannot reach scene-service on http://localhost:8080. Is it running?', path: '/scenes', status: 0 }}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load the scene catalog');
    expect(alert).toHaveTextContent('localhost:8080');
    expect(alert).toHaveTextContent('/api/v1/scenes');
    expect(alert).toHaveTextContent('go run ./cmd/scene-service');
  });

  it('shows the HTTP status instead of the start-it advice when the server did answer', () => {
    render(
      <ErrorBlock
        what="access windows"
        failure={{ message: 'answered 503', path: '/access-windows', status: 503 }}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('HTTP 503');
    expect(alert).not.toHaveTextContent('go run');
  });

  it('retries when asked', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorBlock
        what="the scene catalog"
        failure={{ message: 'down', path: '/scenes', status: 0 }}
        onRetry={onRetry}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button when there is nothing to retry with', () => {
    render(<ErrorBlock what="x" failure={{ message: 'down', path: '/scenes', status: 0 }} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
