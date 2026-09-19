import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SceneSheet } from './SceneSheet';
import { formatDb } from '../lib/format';
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

  // The image is what an operator looks at first, and a SAR image is read
  // differently from a photograph, so the caption has to say what the greys
  // mean and where they came from.
  it('shows the delivered product with its stretch and its source', () => {
    const quicklook = asoScene.quicklook;
    if (quicklook === null) throw new Error('the Aso fixture must carry a quicklook');

    render(<SceneSheet scene={asoScene} />);

    const image = screen.getByRole('img', { name: /Radar backscatter of STRIX-3/ });
    expect(image).toHaveAttribute('src', expect.stringContaining(`/scenes/${asoScene.id}/quicklook.png`));

    const caption = image.parentElement?.querySelector('figcaption');
    expect(caption).toHaveTextContent(`Black is ${formatDb(quicklook.minDb)}`);
    expect(caption).toHaveTextContent(`white ${formatDb(quicklook.maxDb)}`);
    expect(caption).toHaveTextContent('2nd and 98th percentile');
    expect(caption).toHaveTextContent(/about 1[01] m per pixel/);
    expect(caption).toHaveTextContent('Synspective StriX-3 sample product');
  });

  // No placeholder picture, no broken image: the honest sentence.
  it('says plainly that a synthetic scene has no imagery', () => {
    render(<SceneSheet scene={syntheticScene} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/No imagery/)).toBeInTheDocument();
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
