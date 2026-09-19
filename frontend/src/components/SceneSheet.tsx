import type { Quicklook, Scene } from '../interfaces';
import {
  formatDb,
  formatDeg,
  formatDegRange,
  formatGhz,
  formatLatLon,
  formatUtc,
  orDash,
} from '../lib/format';
import { quicklookResolutionM } from '../lib/viewport';

/**
 * The selected scene as a SAR product sheet.
 *
 * The field names are the ones the delivered product and the Synspective SAR
 * Data Product Format Manual actually use - ObservationMode, AntennaPointing,
 * PassDirection, OrbitDataSource and the rest - rather than invented labels, so
 * anyone who has read the manual recognises the sheet immediately. Notebook 01
 * is where those names were read off the real StriX-3 delivery.
 *
 * A synthetic scene says so at the top, in a badge, every time. A catalog that
 * mixes measured and illustrative values without marking which is which is
 * worse than no catalog.
 */

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="sheet__row">
      <dt className="sheet__key">{label}</dt>
      <dd className="sheet__value">{value}</dd>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="sheet__group">
      <h3 className="sheet__group-title">{title}</h3>
      <dl style={{ margin: 0 }}>{children}</dl>
    </section>
  );
}

/**
 * What the greys on the map mean, as a value rather than a caption.
 *
 * The picture itself is on the map, drawn inside the footprint it was taken
 * over, so the sheet no longer repeats it. These two numbers do not survive
 * anywhere else, and without them the image on the map is a grey rectangle: the
 * first says which gamma0 values became black and white, the second says how
 * far the rendering is from the product it came from.
 */
function stretchOf(quicklook: Quicklook): string {
  return `${quicklook.minDb.toFixed(1)} to ${quicklook.maxDb.toFixed(1)} dB`;
}

function samplingOf(quicklook: Quicklook): string {
  return `${Math.round(quicklookResolutionM(quicklook))} m/px`;
}

interface Props {
  scene: Scene;
  /** Brings the map to this scene. Absent when there is no map to bring. */
  onLocate?: () => void;
}

export function SceneSheet({ scene, onLocate }: Props): React.JSX.Element {
  return (
    <div className="sheet">
      <div className="sheet__banner">
        <span
          className={`badge ${scene.synthetic ? 'badge--synthetic' : 'badge--real'}`}
          data-testid="scene-provenance"
        >
          {scene.synthetic ? 'Synthetic scene' : 'Delivered product'}
        </span>
        {onLocate && (
          <button type="button" className="button" onClick={onLocate}>
            Locate on map
          </button>
        )}
      </div>

      <Group title="Identification">
        <Row label="Scene ID" value={orDash(scene.id)} />
        <Row label="Satellite" value={orDash(scene.satellite)} />
        <Row label="Product level" value={orDash(scene.productLevel)} />
        <Row label="Acquired" value={formatUtc(scene.acquiredUtc)} />
      </Group>

      <Group title="Acquisition">
        <Row label="ObservationMode" value={orDash(scene.imagingMode)} />
        <Row label="RadarBand" value={`${orDash(scene.radarBand)} · ${formatGhz(scene.radarCenterFrequencyGhz)}`} />
        <Row label="Polarizations" value={orDash(scene.polarization)} />
        <Row label="AntennaPointing" value={`${orDash(scene.lookSide)}-looking`} />
        <Row label="PassDirection" value={orDash(scene.passDirection)} />
        <Row label="PlatformHeading" value={formatDeg(scene.platformHeadingDeg)} />
      </Group>

      <Group title="Geometry">
        <Row label="Incidence (centre)" value={formatDeg(scene.incidenceAngleDeg)} />
        <Row
          label={'Incidence near–far'}
          value={formatDegRange(scene.incidenceNearDeg, scene.incidenceFarDeg)}
        />
        <Row label="Off-nadir" value={formatDeg(scene.offNadirDeg)} />
        <Row label="Scene centre" value={formatLatLon(scene.centerLatDeg, scene.centerLonDeg)} />
      </Group>

      <Group title="Radiometry and orbit">
        <Row label="NESZ" value={formatDb(scene.neszDb)} />
        <Row label="OrbitDataSource" value={orDash(scene.orbitSource)} />
        <Row label="Footprint vertices" value={String(scene.footprint.length)} />
        {/* Both are "--" for a synthetic scene, which has no product to render
            and therefore nothing on the map either. */}
        <Row
          label="Quicklook stretch"
          value={scene.quicklook ? stretchOf(scene.quicklook) : '--'}
        />
        <Row
          label="Quicklook sampling"
          value={scene.quicklook ? samplingOf(scene.quicklook) : '--'}
        />
      </Group>
    </div>
  );
}
