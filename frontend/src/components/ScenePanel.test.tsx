import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScenePanel } from './ScenePanel';
import type { Loadable, Scene } from '../interfaces';
import { asoScene, sampleScenes } from '../testFixtures';

const ready: Loadable<Scene[]> = { status: 'ready', data: sampleScenes, error: null };

const loading: Loadable<Scene[]> = { status: 'loading', data: null, error: null };

describe('ScenePanel', () => {
  it('shows a loading state while the catalog is in flight', () => {
    render(
      <ScenePanel
        catalog={loading}
        scenes={[]}
        selected={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading the scene catalog');
  });

  it('shows the actionable error when the catalog failed', () => {
    render(
      <ScenePanel
        catalog={{
          status: 'error',
          data: null,
          error: { message: 'Cannot reach scene-service', path: '/scenes', status: 0 },
        }}
        scenes={[]}
        selected={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('/api/v1/scenes');
  });

  it('invites a selection when the catalog loaded but nothing is picked', () => {
    render(
      <ScenePanel
        catalog={ready}
        scenes={sampleScenes}
        selected={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('No scene selected')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Pick one of the ${sampleScenes.length} scenes`))).toBeInTheDocument();
  });

  it('distinguishes "nothing selected" from "everything filtered out"', () => {
    render(
      <ScenePanel
        catalog={ready}
        scenes={[]}
        selected={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('No scenes match')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Scenes matching/ })).not.toBeInTheDocument();
  });

  it('renders the product sheet once a scene is selected', () => {
    render(
      <ScenePanel
        catalog={ready}
        scenes={sampleScenes}
        selected={asoScene}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('ObservationMode')).toBeInTheDocument();
    expect(screen.getByText(asoScene.id)).toBeInTheDocument();
    expect(screen.queryByText('No scene selected')).not.toBeInTheDocument();
  });

  // The whole reason the list exists: the map is a WebGL canvas, so without it
  // there is no way to reach the product sheet from a keyboard at all.
  it('selects a scene from the keyboard, with no map involved', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <ScenePanel
        catalog={ready}
        scenes={sampleScenes}
        selected={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole('button');
    await user.tab();
    expect(rows[0]).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(sampleScenes[0]?.id);
  });

  it('marks the selected row as current, so the list and the sheet agree', () => {
    render(
      <ScenePanel
        catalog={ready}
        scenes={sampleScenes}
        selected={asoScene}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(asoScene.satellite);
  });

  // Before this, filtering out the selected scene made the sheet disappear with
  // no explanation, which reads as the selection being lost rather than hidden.
  it('keeps the sheet and flags it when the filters exclude the selection', () => {
    render(
      <ScenePanel
        catalog={ready}
        scenes={[]}
        selected={asoScene}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      `${asoScene.id} is outside the current filters`,
    );
    // The sheet itself is still there: the user does not lose what they were reading.
    expect(screen.getByText('ObservationMode')).toBeInTheDocument();
  });
});
