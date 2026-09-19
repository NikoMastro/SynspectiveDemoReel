import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Masthead, backendHealth } from './Masthead';
import type { ConsoleData, Loadable } from '../interfaces';

const at = <T,>(status: Loadable<T>['status']): Loadable<T> => ({
  status,
  data: null,
  error: status === 'error' ? { message: 'down', path: '/scenes', status: 0 } : null,
});

const data = (
  scenes: Loadable<never>['status'],
  satellites = scenes,
  tracks = scenes,
  access = scenes,
): ConsoleData =>
  ({
    scenes: at(scenes),
    satellites: at(satellites),
    tracks: at(tracks),
    access: at(access),
  }) as unknown as ConsoleData;

describe('backendHealth', () => {
  it('is ok only when every resource arrived', () => {
    expect(backendHealth(data('ready'))).toBe('ok');
  });

  it('is down when every resource failed', () => {
    expect(backendHealth(data('error'))).toBe('down');
  });

  it('is degraded, not down, when only some failed - a half-broken backend is its own state', () => {
    expect(backendHealth(data('ready', 'ready', 'ready', 'error'))).toBe('degraded');
  });

  it('is connecting while anything is still in flight', () => {
    expect(backendHealth(data('ready', 'ready', 'loading', 'ready'))).toBe('loading');
  });

  it('prefers reporting a failure over reporting that it is still loading', () => {
    expect(backendHealth(data('loading', 'error', 'loading', 'loading'))).toBe('degraded');
  });
});

describe('Masthead', () => {
  it('says at a glance whether the console is talking to the backend', () => {
    render(<Masthead data={data('ready')} />);
    expect(screen.getByTestId('backend-health')).toHaveTextContent('Backend online');
  });

  it('says so when it is not', () => {
    render(<Masthead data={data('error')} />);
    expect(screen.getByTestId('backend-health')).toHaveTextContent('Backend unreachable');
  });

  it('states the provenance of the data up front', () => {
    render(<Masthead data={data('ready')} />);
    expect(screen.getByRole('heading', { name: 'StriX Scene Explorer' })).toBeInTheDocument();
    expect(screen.getByText(/Celestrak/)).toBeInTheDocument();
    expect(screen.getByText(/synthetic and labelled as such/)).toBeInTheDocument();
  });
});
