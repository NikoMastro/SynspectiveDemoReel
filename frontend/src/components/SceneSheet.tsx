import type { Scene } from '../interfaces';
import {
  formatDb,
  formatDeg,
  formatDegRange,
  formatGhz,
  formatLatLon,
  formatUtc,
  orDash,
} from '../lib/format';

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

export function SceneSheet({ scene }: { scene: Scene }): React.JSX.Element {
  return (
    <div className="sheet">
      <div className="sheet__banner">
        <span
          className={`badge ${scene.synthetic ? 'badge--synthetic' : 'badge--real'}`}
          data-testid="scene-provenance"
        >
          {scene.synthetic ? 'Synthetic scene' : 'Delivered product'}
        </span>
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
      </Group>
    </div>
  );
}
