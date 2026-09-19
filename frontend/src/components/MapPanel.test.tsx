/**
 * The canvas is replaced by a div that reports the layer ids it was handed, and
 * the opacity of the quicklook layer if there is one. That is enough to check
 * that the two imagery controls do what they say without a WebGL context; what
 * each layer draws is covered by lib/layers.test.ts.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { MapPanel } from './MapPanel';
import { satelliteColorScale } from '../lib/colors';
import { asoScene, sampleAccess, sampleScenes } from '../testFixtures';

vi.mock('@deck.gl/react', () => ({
  default: (props: { layers: Layer[] }) => {
    const quicklook = props.layers.find((l) => l.id === 'scene-quicklook');
    const opacity = quicklook ? (quicklook.props as { opacity?: number }).opacity : undefined;
    return (
      <div
        data-testid="deck-canvas"
        data-layers={props.layers.map((l) => l.id).join(' ')}
        data-quicklook-opacity={opacity === undefined ? '' : String(opacity)}
      />
    );
  },
}));

const quicklook = asoScene.quicklook;
if (quicklook === null) throw new Error('the Aso fixture must carry a quicklook');

const imagery = {
  sceneId: asoScene.id,
  quicklook,
  url: '/api/v1/scenes/STRIX3-20260615T063527Z-SL1/quicklook.png',
};

const base = {
  scenes: sampleScenes,
  tracks: [],
  subSatellite: [],
  targets: sampleAccess.targets,
  windowCounts: new Map<string, number>(),
  colors: satelliteColorScale(['STRIX-3', 'STRIX-5']),
  selectedSceneId: asoScene.id,
  highlightedSatellite: null,
  locate: null,
  onSelectScene: () => {},
};

const drawnLayers = () => screen.getByTestId('deck-canvas').dataset.layers ?? '';
const drawnOpacity = () => screen.getByTestId('deck-canvas').dataset.quicklookOpacity;

describe('MapPanel imagery controls', () => {
  it('draws the quicklook, switched on, when the selected scene has one', () => {
    render(<MapPanel {...base} imagery={imagery} />);

    expect(drawnLayers()).toContain('scene-quicklook');
    expect(screen.getByRole('checkbox', { name: 'Radar image' })).toBeChecked();
    expect(drawnOpacity()).toBe('1');
  });

  it('takes the layer away when the operator unticks it, and brings it back', async () => {
    const user = userEvent.setup();
    render(<MapPanel {...base} imagery={imagery} />);

    await user.click(screen.getByRole('checkbox', { name: 'Radar image' }));
    expect(drawnLayers()).not.toContain('scene-quicklook');
    // Every other layer is still there: only the picture went.
    expect(drawnLayers()).toContain('scene-footprints');

    await user.click(screen.getByRole('checkbox', { name: 'Radar image' }));
    expect(drawnLayers()).toContain('scene-quicklook');
  });

  it('passes the slider through as the layer opacity', () => {
    render(<MapPanel {...base} imagery={imagery} />);

    fireEvent.change(screen.getByRole('slider', { name: 'Opacity' }), { target: { value: '40' } });
    expect(drawnOpacity()).toBe('0.4');
  });

  it('offers no controls when the selected scene has nothing to draw', () => {
    render(<MapPanel {...base} imagery={null} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(drawnLayers()).not.toContain('scene-quicklook');
  });
});
