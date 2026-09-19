import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SceneSheet } from './SceneSheet';
import { asoScene, syntheticScene } from '../testFixtures';

describe('SceneSheet', () => {
  it('uses the Format Manual field names, not invented labels', () => {
    render(<SceneSheet scene={asoScene} />);

    for (const field of [
      'ObservationMode',
      'Polarizations',
      'AntennaPointing',
      'PassDirection',
      'PlatformHeading',
      'OrbitDataSource',
      'NESZ',
    ]) {
      expect(screen.getByText(field)).toBeInTheDocument();
    }
  });

  it('shows the delivered StriX-3 values as the product reports them', () => {
    render(<SceneSheet scene={asoScene} />);

    expect(screen.getByText('Sliding Spotlight')).toBeInTheDocument();
    expect(screen.getByText('VV')).toBeInTheDocument();
    expect(screen.getByText('Left-looking')).toBeInTheDocument();
    expect(screen.getByText('31.94°')).toBeInTheDocument();
    expect(screen.getByText('34.34–35.25°')).toBeInTheDocument();
    expect(screen.getByText('2026-06-15 06:35:27Z')).toBeInTheDocument();
    expect(screen.getByText('-23.5 dB')).toBeInTheDocument();
  });

  it('marks a real delivery as such', () => {
    render(<SceneSheet scene={asoScene} />);
    expect(screen.getByTestId('scene-provenance')).toHaveTextContent('Delivered product');
  });

  it('labels a synthetic scene visibly, every time', () => {
    render(<SceneSheet scene={syntheticScene} />);
    expect(screen.getByTestId('scene-provenance')).toHaveTextContent('Synthetic scene');
  });

  it('renders a dash rather than a blank cell for a missing value', () => {
    render(<SceneSheet scene={{ ...asoScene, orbitSource: '' }} />);
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });

  // The picture is on the map, inside the footprint it was taken over, so the
  // sheet does not repeat it. What the sheet has to keep is the pair of numbers
  // that exist nowhere else: without them the greys on the map cannot be read,
  // and there is no way to tell how far the rendering is from the product.
  it('keeps the numbers that decode the map image, and does not repeat the picture', () => {
    render(<SceneSheet scene={asoScene} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    expect(screen.getByText('Quicklook stretch').nextElementSibling).toHaveTextContent(
      '-12.8 to -2.3 dB',
    );
    expect(screen.getByText('Quicklook sampling').nextElementSibling).toHaveTextContent('11 m/px');
  });

  // A synthetic scene has no product behind it, so it has nothing on the map
  // either. Dashes, the same as every other value the product does not state.
  it('dashes both quicklook rows for a synthetic scene', () => {
    render(<SceneSheet scene={syntheticScene} />);

    expect(screen.getByText('Quicklook stretch').nextElementSibling).toHaveTextContent('--');
    expect(screen.getByText('Quicklook sampling').nextElementSibling).toHaveTextContent('--');
  });

  it('offers to bring the map to the scene', async () => {
    const onLocate = vi.fn();
    const user = userEvent.setup();
    render(<SceneSheet scene={asoScene} onLocate={onLocate} />);

    await user.click(screen.getByRole('button', { name: 'Locate on map' }));
    expect(onLocate).toHaveBeenCalledTimes(1);
  });

  it('has no locate button when there is no map to bring', () => {
    render(<SceneSheet scene={asoScene} />);
    expect(screen.queryByRole('button', { name: 'Locate on map' })).not.toBeInTheDocument();
  });
});
