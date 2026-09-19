import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
