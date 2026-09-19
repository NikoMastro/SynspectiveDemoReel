import type { Quicklook, Scene } from '../interfaces';
import { quicklookUrl } from '../lib/api';
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
 * The picture, and what its greys mean. An operator reads a SAR image
 * differently from a photograph, so the caption says how: it is the same
 * scale notebook 01 chose, and the same words.
 */
function Imagery({ scene, quicklook }: { scene: Scene; quicklook: Quicklook }): React.JSX.Element {
  const metresPerPixel = Math.round(quicklookResolutionM(quicklook));
  return (
    <figure className="sheet__figure">
      <img
        className="sheet__image"
        src={quicklookUrl(scene.id)}
        width={quicklook.widthPx}
        height={quicklook.heightPx}
        loading="lazy"
        decoding="async"
        alt={`Radar backscatter of ${scene.satellite} scene ${scene.id}: gamma0 in decibels, brighter is a stronger return`}
      />
      <figcaption className="sheet__caption">
        gamma0 backscatter, {orDash(scene.polarization)}, in decibels. Black is{' '}
        {formatDb(quicklook.minDb)} and white {formatDb(quicklook.maxDb)}, the 2nd and 98th
        percentile of the scene. Bright is a strong return: buildings, and slopes facing the
        radar. Dark is a smooth surface, water and roads, or radar shadow behind a ridge.
        Rendered at about {metresPerPixel} m per pixel; the delivered product resolves{' '}
        {scene.resolutionRangeM.toFixed(2)} m in range and {scene.resolutionAzimuthM.toFixed(2)} m
        in azimuth. Source: Synspective StriX-3 sample product.
      </figcaption>
    </figure>
  );
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

      {/* First, because it is what an operator looks at first. Full width: a
          picture in half a column is a thumbnail, and this one has a caldera in it. */}
      <section className="sheet__group sheet__group--wide">
        <h3 className="sheet__group-title">Imagery</h3>
        {scene.quicklook ? (
          <Imagery scene={scene} quicklook={scene.quicklook} />
        ) : (
          <p className="sheet__caption">
            No imagery. This scene is synthetic: no product was delivered, so there is nothing
            to render.
          </p>
        )}
      </section>

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
      </Group>
    </div>
  );
}
