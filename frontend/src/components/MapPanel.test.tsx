/**
 * The canvas is replaced by a div that reports the layer ids it was handed, and
 * the opacity of the quicklook layer if there is one. That is enough to check
 * that the two imagery controls do what they say without a WebGL context; what
 * each layer draws is covered by lib/layers.test.ts.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { MapPanel } from './MapPanel';
import { satelliteColorScale } from '../lib/colors';
import { asoScene, sampleAccess, sampleScenes } from '../testFixtures';

interface StubDeckProps {
  layers: Layer[];
  viewState: { zoom: number };
  onViewStateChange: (params: {
    viewState: { zoom: number };
    interactionState: { inTransition?: boolean };
  }) => void;
}

/** The last props the map handed to deck.gl, so a test can call back into it. */
const deck = vi.hoisted(() => ({ props: null as StubDeckProps | null }));

vi.mock('@deck.gl/react', () => ({
  default: (props: StubDeckProps) => {
    deck.props = props;
    const quicklook = props.layers.find((l) => l.id === 'scene-quicklook');
    const opacity = quicklook ? (quicklook.props as { opacity?: number }).opacity : undefined;
    return (
      <div
        data-testid="deck-canvas"
        data-layers={props.layers.map((l) => l.id).join(' ')}
        data-quicklook-opacity={opacity === undefined ? '' : String(opacity)}
        data-view-zoom={String(props.viewState.zoom)}
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
  // Not at full strength: the point of draping the image on a basemap is to
  // read the two together, and at 100% the basemap underneath is simply gone.
  it('draws the quicklook, switched on and part-transparent, when the scene has one', () => {
    render(<MapPanel {...base} imagery={imagery} />);

    expect(drawnLayers()).toContain('scene-quicklook');
    expect(screen.getByRole('checkbox', { name: 'Radar image' })).toBeChecked();
    expect(drawnOpacity()).toBe('0.65');
    expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveValue('65');
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

  // The picture is a rendering of somebody else's sample product. It used to be
  // credited in the sheet's caption; the sheet no longer repeats the picture, so
  // the credit has to sit where the picture is.
  it('credits the radar image beside the basemap, and only while one is drawn', () => {
    const { rerender } = render(<MapPanel {...base} imagery={imagery} />);
    expect(screen.getByText(/Synspective StriX-3 sample product/)).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();

    rerender(<MapPanel {...base} imagery={null} />);
    expect(screen.queryByText(/Synspective StriX-3 sample product/)).not.toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();
  });
});

/**
 * The camera is controlled, which is what lets "Locate on map" move a map the
 * operator has already panned. The cost of controlling it is this: deck.gl
 * reports every interpolated frame of a fly-to back through onViewStateChange,
 * and storing one re-renders with a view state carrying no transition props -
 * which deck.gl reads as the caller taking the camera somewhere else, so it
 * cancels the flight mid-air.
 *
 * It was a race, not a certainty: it survived whenever React re-rendered fast
 * enough for deck.gl to still recognise the frame as its own echo. Measured
 * against the running console, picking a scene flew the map in two rounds out
 * of three on the dev server and in none out of four on the built one.
 */
describe('MapPanel camera', () => {
  const frame = (zoom: number, inTransition: boolean) =>
    act(() => {
      deck.props?.onViewStateChange({
        viewState: { zoom },
        interactionState: { inTransition },
      });
    });

  const zoom = () => screen.getByTestId('deck-canvas').dataset.viewZoom;

  it('ignores deck.gl’s own frames while it is flying the camera', () => {
    render(<MapPanel {...base} imagery={imagery} />);
    const opening = zoom();

    frame(7.5, true);

    expect(zoom()).toBe(opening);
  });

  it('stores the camera the operator moves', () => {
    render(<MapPanel {...base} imagery={imagery} />);

    frame(7.5, false);

    expect(zoom()).toBe('7.5');
  });
});
